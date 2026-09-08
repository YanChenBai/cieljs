import { checkConfiguration, installModels, type ModelInstallProgress } from '@cieljs/hearing';
import { os } from '@orpc/server';

import { watchConfigurationStatus } from '../config.ts';

/** 安装任务由主进程持有，刷新页面不会重复下载或丢失错误。 */
export function createSetupRoutes() {
  let installation: Promise<void> | undefined;
  let progress: ModelInstallProgress | undefined;
  let error: string | undefined;

  async function status() {
    return {
      ...(await checkConfiguration()),
      installing: installation !== undefined,
      progress,
      error,
    };
  }

  return {
    configuration: os.handler(() => watchConfigurationStatus()),
    hearingModels: os.handler(status),
    installHearingModels: os.handler(() => {
      if (!installation) {
        error = undefined;
        progress = undefined;
        installation = installModels({
          onProgress: value => {
            progress = value;
          },
        })
          .then(() => {
            progress = undefined;
          })
          .catch(cause => {
            error = cause instanceof Error ? cause.message : String(cause);
          })
          .finally(() => {
            installation = undefined;
          });
      }

      // 立即返回，避免大模型下载耗时超过 RPC 请求生命周期。
      return status();
    }),
  };
}
