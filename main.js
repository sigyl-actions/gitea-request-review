import fs from 'fs';
import { Blob } from 'buffer';


import core from '@actions/core';
import github from '@actions/github';

import { GiteaApi } from 'gitea-api';

async function run() {
  try {
    console.log('review requester')
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
      }))

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
    const nextTeamReview = teamReviews
      .find(
        ({
          reviews,
        }) => !reviews.length || reviews
          .find(
            ({
              official,
              stale,
              dismissed,
              state,
            }) => official && (stale || dismissed || state !== 'APPROVED')
          )
      )
    if (nextTeamReview) {
      if (!nextTeamReview.reviews.filter(({ user }) => user).length) {
        console.log(
          JSON.stringify(
            {
              reason: 'team',
              nextTeamReview,
            },
            null,
            2,
          )
        )
        await client.repository.repoCreatePullReviewRequests({
          owner,
          repo,
          index: core.getInput('pr') || 73,
          body: {
            team_reviewers: [
              nextTeamReview.team
            ]
          },
        });
      } else {

        console.log(
          JSON.stringify(
            {
              reason: 'users',
              nextTeamReview,
              reviewers: nextTeamReview
                .reviews
                .filter(
                  ({
                    official,
                    stale,
                    dismissed,
                    state,
                    user,
                  }) => user && official && (stale || dismissed || state !== 'APPROVED')
                ).map(
                  ({ user }) => user.login,
                )
            },
            null,
            2,
          )
        )

        await client.repository.repoCreatePullReviewRequests({
          owner,
          repo,
          index: core.getInput('pr') || 73,
          body: {
            reviewers: nextTeamReview
              .reviews
              .filter(
                ({
                  official,
                  stale,
                  dismissed,
                  state,
                  user,
                }) => user && official && (stale || dismissed || state !== 'APPROVED')
              ).map(
                ({ user }) => user.login,
              )
          },
        });
      }
    }

  }
  catch (error) {
    console.error(error)
    core.setFailed(error.message);
  }
}

run()
