import * as Github from '@octokit/rest';

import logger from '../logger';

/**
 * Get an authenticated Github client object
 *
 * The authentication token is taken from the environment, if not provided.
 *
 * @param token Github authentication token
 */
export function getGithubClient(token: string = ''): Github {
  let githubApiToken = token;
  if (!githubApiToken) {
    githubApiToken = process.env.GITHUB_API_TOKEN || '';
    if (!githubApiToken) {
      throw new Error(
        'GitHub target: GITHUB_API_TOKEN not found in the environment'
      );
    }
  }
  const github = new Github();
  github.authenticate({ token: githubApiToken, type: 'token' });
  return github;
}

/**
 * Loads a file from the context's repository
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @param path The path of the file in the repository
 * @param ref The string name of commit / branch / tag
 * @returns The decoded file contents
 */
export async function getFile(
  github: Github,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const response = await github.repos.getContent({
      owner,
      path,
      ref,
      repo,
    });
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (err) {
    if (err.code === 404) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Merge the given release branch into the base branch.
 *
 * @param github Github client
 * @param owner Repository owner
 * @param repo Repository name
 * @param branch Branch to be merged
 * @param base Base branch; set to default repository branch, if not provided
 * @returns commit SHA of merge commit
 */
export async function mergeReleaseBranch(
  github: Github,
  owner: string,
  repo: string,
  branch: string,
  base?: string
): Promise<string> {
  let baseBranch = base || '';
  if (!baseBranch) {
    const repoInfo = await github.repos.get({ owner, repo });
    baseBranch = repoInfo.data.default_branch;
  }

  try {
    logger.info(`Merging release branch: "${branch}" into "${baseBranch}"...`);
    const response = await github.repos.merge({
      base: baseBranch,
      head: branch,
      owner,
      repo,
    });
    logger.info(`Merging: done.`);
    return response.data.sha as string;
  } catch (err) {
    if (err.code === 409) {
      // Conflicts found
      logger.error(
        `Cannot merge release branch "${branch}": conflicts detected`,
        'Please resolve the conflicts and merge the branch manually:',
        `    git checkout master && git merge ${branch}`
      );
    }
    throw err;
  }
}