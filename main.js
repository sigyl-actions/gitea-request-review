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
          official,
          user,
          team,
          state,
        }) => (official && !dismissed) || !user && team && state === 'REQUEST_REVIEW'
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

    const nonDismissedReview = teamReviews.filter(
      ({
        reviews,
      }) => !reviews
        .length
        || reviews.find(({ state }) => state === 'REQUEST_CHANGES'),
    )[0]
    
    const reviewers = nonDismissedReview
      ? nonDismissedReview.reviews.filter(({ user, state }) => user && state === 'REQUEST_CHANGES')
      : [];

    const body = {
      reviewers: reviewers.map(({ user }) => user.login ),
      team_reviewers: [
        ...nonDismissedReview ? [
          nonDismissedReview.team
        ] : [],
      ],
    };
    console.log(
      JSON.stringify(
        {
          teamReviews,
          nonDismissedReview,
          body,
        },
        null,
        2,
      )
    )
    
    await client.repository.repoCreatePullReviewRequests({
      owner,
      repo,
      index: core.getInput('pr') || 72,
      body,
    });
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
