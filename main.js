import fs from 'fs';
import { Blob } from 'buffer';


import core from '@actions/core';
import github from '@actions/github';

import { GiteaApi } from 'gitea-api';

async function run() {
  try {
    const serverUrl = core.getInput('serverUrl')
      || (github.context.runId && github.context.serverUrl)
      || 'https://sigyl.com/git'

    const client = new GiteaApi({
      BASE: `${serverUrl}/api/v1`,
      WITH_CREDENTIALS: true,
      TOKEN: core.getInput('token') || process.argv[2],
    });
    const [owner, repo] = (
      core.getInput('repository')
      || github?.context?.payload?.repository?.full_name
      || 'actions/batch-example'
    ).split("/");

    const reviews = (await client
      .repository
      .repoListPullReviews({
        owner,
        repo,
        index: core.getInput('pr') || 72,
      })).filter(
        ({
          dismissed,
          stale,
          official,
          user,
          team,
          state,
        }) => (official && !dismissed && !stale) || !user && team && state === 'REQUEST_REVIEW'
      );

    const orgTeams = await Promise.all((
      await client
        .organization
        .orgListTeams({
          org: owner,
        })
    ).map(
      async (
        team,
      ) => ({
        team,
        members: await client
          .organization
          .orgListTeamMembers({
            id: team.id,
          })
      })
    ));

    const teams = core.getInput('teams')
      ? core.getInput('teams').split(',')
      : [
        "reviewers",
        "reviewers-2"
      ];
    const teamReviews = teams
      .map(
        (team) => ({
          team,
          reviews: reviews
            .filter(
              ({
                state,
                user,
                team: teamObject,
              }) => orgTeams
                .find(
                  ({
                    team: {
                      name,
                    },
                    members,
                  }) => name === team
                    && (teamObject || members
                      .find(
                        ({
                          id: memberId
                        }) => memberId === user.id,
                      ))
                ),
            )
        })
      );

    console.log(
      JSON.stringify(
        {
          teamReviews,
        },
        null,
        2,
      )
    );
    const reviewRequests = teamReviews
      .filter(
        ({
          reviews,
        }) => reviews
          .find(
            ({
              state,
              dismissed,
              stale,
            }) => state === 'REQUEST_REVIEW'
              || state === 'REQUEST_CHANGES',
          )
      );
    const requestIndex = teamReviews
      .findIndex(
        ({
          reviews,
        }) => reviews
          .find(
            ({
              state,
            }) => state === 'REQUEST_REVIEW'
              || state === 'REQUEST_CHANGES',
          )
      );
    console.log({ requestIndex })
    const deleteRequests = teamReviews
      .slice(requestIndex + 1)
      .map(
        ({
          team,
        }) => team,
      );
    console.log({ deleteRequests })

    if (deleteRequests.length) {
      console.log(
        'nothing',
        await client.repository.repoDeletePullReviewRequests({
          owner,
          repo,
          index: core.getInput('pr') || 72,
          body: {
            team_reviewers: deleteRequests,
          }
        })
      )
    }

    const nonDismissedReviews = teamReviews.filter(
      ({
        reviews,
      }) => !reviews
        .length,
    )
    if (
      !reviewRequests.length &&
      nonDismissedReviews.length
    ) {
      console.log('requesting review for', nonDismissedReviews[0].team)
      console.log(
        JSON.stringify(
          {
            reviews,
            teams,
            api: await client.repository.repoCreatePullReviewRequests({
              owner,
              repo,
              index: core.getInput('pr') || 72,
              body: {
                team_reviewers: [
                  nonDismissedReviews[0].team,
                ],
              }
            }),
          },
          null,
          2
        ),
      );
    } else {
      console.log('nothing done')
    }
  }
  catch (error) {
    console.error(error)
    core.setFailed(error.message);
  }
}

run()
