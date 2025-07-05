import { Octokit } from '@octokit/rest';
import { encode as arrayBufferToBase64 } from 'base64-arraybuffer';
// https://github.com/octokit/rest.js/issues/1971
import type { components } from '@octokit/openapi-types';

type GetRepoContentResponseDataFile = components['schemas']['content-file'];

export interface GitCommitPushOptions {
  owner: string;
  repo: string;
  files: {
    path: string;
    content: string | null;
  }[];
  ref: string;
  forceUpdate?: boolean;
  commitMessage?: string;
  token?: string;
}

const getReferenceCommit = (
  octokit: Octokit,
  options: Pick<GitCommitPushOptions, 'owner' | 'repo' | 'ref'>
) =>
  octokit.git
    .getRef({
      owner: options.owner,
      repo: options.repo,
      ref: options.ref,
    })
    .then((res) => {
      return { referenceCommitSha: res.data.object.sha };
    });

const createTree = (
  octokit: Octokit,
  options: Pick<GitCommitPushOptions, 'owner' | 'repo' | 'files'>,
  data: { referenceCommitSha: string }
) => {
  const promises = options.files.map((file) => {
    if (typeof file.content === 'string') {
      return octokit.git
        .createBlob({
          owner: options.owner,
          repo: options.repo,
          content: file.content,
          encoding: 'utf-8',
        })
        .then((blob: any) => {
          return {
            sha: blob.data.sha,
            path: file.path,
            mode: '100644',
            type: 'blob',
          } as const;
        });
    } else if (ArrayBuffer.isView(file.content)) {
      return octokit.git
        .createBlob({
          owner: options.owner,
          repo: options.repo,
          content: arrayBufferToBase64(file.content),
          encoding: 'base64',
        })
        .then((blob: any) => {
          return {
            sha: blob.data.sha,
            path: file.path,
            mode: '100644',
            type: 'blob',
          } as const;
        });
    } else if (file.content === null) {
      return Promise.resolve({
        sha: null,
        path: file.path,
        mode: '100644',
        type: 'blob',
      } as const);
    }

    throw new Error(`This file can not handled: ${file}`);
  });
  return Promise.all(promises).then((files) => {
    return octokit.git
      .createTree({
        owner: options.owner,
        repo: options.repo,
        tree: files,
        base_tree: data.referenceCommitSha,
      })
      .then((res) => {
        return {
          ...data,
          newTreeSha: res.data.sha,
        };
      });
  });
};

const createCommit = (
  octokit: Octokit,
  options: Pick<GitCommitPushOptions, 'owner' | 'repo' | 'commitMessage'>,
  data: any
) =>
  octokit.git
    .createCommit({
      owner: options.owner,
      repo: options.repo,
      message: options.commitMessage || 'commit',
      tree: data.newTreeSha,
      parents: [data.referenceCommitSha],
    })
    .then((res) => {
      return { ...data, newCommitSha: res.data.sha };
    });

const updateReference = (
  github: Octokit,
  options: GitCommitPushOptions,
  data: any
) =>
  github.git.updateRef({
    owner: options.owner,
    repo: options.repo,
    ref: options.ref,
    sha: data.newCommitSha,
    force: options.forceUpdate,
  });

export const getContent = (
  github: Octokit,
  {
    owner,
    repo,
    path,
    ref,
  }: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }
) => {
  return github.repos
    .getContent({
      owner,
      repo,
      path,
      ref,
    })
    .then((res) => {
      const data = res.data as GetRepoContentResponseDataFile;
      if (Array.isArray(data)) {
        throw new Error(`folder does not support`);
      }
      if (data.type !== 'file') {
        return Promise.reject(new Error('This is not file:' + path));
      }
      if (data.encoding === 'base64') {
        // TODO: support binary
        return Promise.resolve(atob(data.content));
      }
      throw new Error('Unknown file type' + data.type + ':' + data.encoding);
    });
};

export const deleteFile = async (
  octokit: Octokit,
  {
    owner,
    repo,
    path,
    ref,
    commitMessage,
  }: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
    commitMessage: string;
  }
) => {
  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });
  const { data } = response;
  if (Array.isArray(data)) {
    throw new Error(`folder does not support`);
  }
  return octokit.repos.deleteFile({
    owner,
    repo,
    path,
    branch: ref.replace(/^refs\//, '').replace(/^heads\//, ''),
    sha: data.sha,
    message: commitMessage,
  });
};

export interface GitHubAdaptorOptions {
  host?: string;
  owner: string;
  repo: string;
  ref: string;
  commitMessage?: {
    write?: (filePath: string) => string;
    delete?: (filePath: string) => string;
  };
  forceUpdate?: boolean;
  token?: string; // or process.env.GITHUB_API_TOKEN
}

export const createGitHubAdaptor = (options: GitHubAdaptorOptions) => {
  const token = options.token;
  if (!token) {
    throw new Error(`token is not defined`);
  }
  const octKit = new Octokit({
    auth: token,
    type: 'oauth',
    userAgent: 'korefile',
  });
  const filledOptions = {
    owner: options.owner,
    repo: options.repo,
    ref: options.ref,
    forceUpdate: options.forceUpdate || false,
  };
  return {
    readFile(filePath: string): Promise<string> {
      return getContent(octKit, {
        repo: filledOptions.repo,
        owner: filledOptions.owner,
        path: filePath,
        ref: filledOptions.ref,
      });
    },
    writeFile(
      filePath: string,
      content: string | ArrayBuffer
    ): Promise<unknown> {
      const withFileOption = {
        ...filledOptions,
        files: [
          {
            path: filePath,
            content,
          },
        ],
      };
      const commitMessage =
        options.commitMessage &&
        typeof options.commitMessage.write === 'function'
          ? options.commitMessage.write(filePath)
          : `Update ${filePath}`;
      return commit(withFileOption, commitMessage);
    },
    writeFiles(
      files: { path: string; content: string | ArrayBuffer }[]
    ): Promise<unknown> {
      const withFileOption = {
        ...filledOptions,
        files,
      };
      const commitMessage = `:memo: update commands`;
      return commit(withFileOption, commitMessage);
    },
    deleteFile(filePath: string): Promise<unknown> {
      const commitMessage =
        options.commitMessage &&
        typeof options.commitMessage.delete === 'function'
          ? options.commitMessage.delete(filePath)
          : `Delete ${filePath}`;
      return deleteFile(octKit, {
        ...filledOptions,
        commitMessage,
        path: filePath,
      });
    },
  };

  function commit(withFileOption: any, commitMessage: string) {
    return getReferenceCommit(octKit, filledOptions)
      .then((data) => createTree(octKit, withFileOption, data))
      .then((data) =>
        createCommit(
          octKit,
          {
            ...filledOptions,
            commitMessage,
          },
          data
        )
      )
      .then((data) => updateReference(octKit, withFileOption, data));
  }
};
