/** English copy for the local effort control. Provider effort names remain provider-owned. */
export const en = {
  effort: 'Effort',
  choose: 'Reasoning effort',
  pending: 'Saving…',
  failed: 'Could not change reasoning effort. Try again.',
  unavailable: 'This model does not declare multiple reasoning levels.',
  loading: 'Loading reasoning levels…',
  retry: 'Retry',
  next: 'Applies to the next model request.',
  close: 'Close reasoning effort',
}

/** Keys owned by the local effort dictionary. */
export type EffortKey = keyof typeof en

/** Chinese copy with the same keys as the English dictionary. */
export const zh: Record<EffortKey, string> = {
  effort: '推理等级',
  choose: '推理强度',
  pending: '正在保存…',
  failed: '无法更改推理等级。请重试。',
  unavailable: '此模型未声明多个推理等级。',
  loading: '正在加载推理等级…',
  retry: '重试',
  next: '应用于下一次模型请求。',
  close: '关闭推理等级',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fork-local effort control copy. */
    'local-effort': EffortKey
  }
}
