import * as Github from '@octokit/rest';
import { shouldPerform } from 'dryrun';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';

import { getConfiguration, getGlobalGithubConfig } from '../config';
import loggerRaw from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { ZeusStore } from '../stores/zeus';
import { DEFAULT_CHANGELOG_PATH, findChangeset } from '../utils/changes';
import { getFile, getGithubClient } from '../utils/github_api';
import { isPreviewRelease } from '../utils/version';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[github]');

/**
 * Default content type for GitHub release assets
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Configuration options for the Github target
 */
export interface GithubTargetConfig extends TargetConfig, GithubGlobalConfig {
  changelog?: string;
  tagPrefix?: string;
  previewReleases?: boolean;
}

/**
 * An interface that represents a minimal Github release as returned by
 * Github API.
 */
interface GithubRelease {
  id: number;
  tag_name: string;
  upload_url: string;
}

/**
 * Target responsible for publishing releases on Github
 */
export class GithubTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'github';
  /** Target options */
  public readonly githubConfig: GithubTargetConfig;
  /** Github client */
  public readonly github: Github;

  public constructor(config: any, store: ZeusStore) {
    super(config, store);
    this.githubConfig = {
      ...getGlobalGithubConfig(),
      changelog: getConfiguration().changelog,
      previewReleases:
        this.config.previewReleases === undefined
          ? true
          : this.config.previewReleases,
      tagPrefix: this.config.tagPrefix || '',
    };
    this.github = getGithubClient();
  }

  /**
   * Gets an existing or creates a new release for the given tag
   *
   * The release name and description body is loaded from CHANGELOG.md in the
   * respective tag, if present. Otherwise, the release name defaults to the
   * tag and the body to the commit it points to.
   *
   * @param context Github context
   * @param tag Tag name for this release
   * @returns The newly created release
   */
  public async getOrCreateRelease(
    tag: string,
    revision: string,
    isPreview: boolean = false
  ): Promise<GithubRelease> {
    try {
      const response = await this.github.repos.getReleaseByTag({
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        tag,
      });
      logger.debug(`Found the existing release for tag "${tag}"`);
      return response.data;
    } catch (e) {
      if (e.code !== 404) {
        throw e;
      }
      logger.debug(`Release for tag "${tag}" not found.`);
    }
    // Release hasn't been found, so create one
    const changelog = await getFile(
      this.github,
      this.githubConfig.owner,
      this.githubConfig.repo,
      this.githubConfig.changelog || DEFAULT_CHANGELOG_PATH,
      revision
    );
    const changes = (changelog && findChangeset(changelog, tag)) || {};
    logger.debug('Changes extracted from changelog: ', JSON.stringify(changes));

    const params = {
      draft: false,
      name: tag,
      owner: this.githubConfig.owner,
      prerelease: isPreview,
      repo: this.githubConfig.repo,
      tag_name: tag,
      target_commitish: revision,
      ...changes,
    };

    if (shouldPerform()) {
      logger.info(
        `Creating a new ${
          isPreview ? '*preview* ' : ''
        }release for tag "${tag}"`
      );
      const created = await this.github.repos.createRelease(params);
      return created.data;
    } else {
      logger.info(
        `[dry-run] Not creating a new ${
          isPreview ? '*preview* ' : ''
        }release for tag "${tag}"`
      );
      return {
        id: 0,
        tag_name: tag,
        upload_url: '',
      };
    }
  }

  /**
   * Creates a new GitHub release and publish all available artifacts.
   *
   * It also creates a tag if it doesn't exist
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    logger.info(`Target "${this.name}": publishing version "${version}"...`);
    logger.debug(`Revision: ${revision}`);
    const tag = `${this.githubConfig.tagPrefix}${version}`;
    logger.info(`Git tag: "${tag}"`);
    const isPreview =
      this.githubConfig.previewReleases && isPreviewRelease(version);
    const release = await this.getOrCreateRelease(tag, revision, isPreview);

    const artifacts = await this.getArtifactsForRevision(revision);
    await Promise.all(
      artifacts.map(async artifact => {
        const path = await this.store.downloadArtifact(artifact);
        const stats = statSync(path);
        const name = basename(path);

        const params = {
          contentLength: stats.size,
          contentType: artifact.type || DEFAULT_CONTENT_TYPE,
          file: createReadStream(path),
          id: release.id,
          name,
          url: release.upload_url,
        };
        logger.debug('Upload parameters:', JSON.stringify(params));

        logger.info(
          `Uploading asset "${name}" to ${this.githubConfig.owner}/${
            this.githubConfig.repo
          }:${release.tag_name}`
        );
        if (shouldPerform()) {
          return this.github.repos.uploadAsset(params);
        } else {
          logger.info(`[dry-run] Not uploading asset "${name}"`);
          return undefined;
        }
      })
    );
  }
}
