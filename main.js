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
    const teams = core.getInput('teams')
      ? core.getInput('teams').split(',')
      : [
        "reviewers",
        "reviewers-2"
      ];
    
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
    const deleteRequests = teams
      .slice(requestIndex + 1);
    
    if (deleteRequests.length) {
        console.log({ deleteRequests })
        await client.repository.repoDeletePullReviewRequests({
          owner,
          repo,
          index: core.getInput('pr') || 72,
          body: {
            team_reviewers: deleteRequests,
          }
        })
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
      await client.repository.repoCreatePullReviewRequests({
        owner,
        repo,
        index: core.getInput('pr') || 72,
        body: {
          team_reviewers: [
            nonDismissedReviews[0].team,
          ],
        }
      });
    } else {
      console.log('nothing requested')
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
