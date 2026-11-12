export function isNetworkFailure(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection interrupted/i.test(message);
}

export function requestErrorMessage(error) {
  return isNetworkFailure(error)
    ? 'Connection interrupted. Check your connection and try again.'
    : error?.message || 'The request could not be completed. Please try again.';
}

export function fetchWithRecovery(fetcher = globalThis.fetch) {
  return async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    // These report RPCs return the existing result on retry and award points once.
    const retryable = ['GET', 'HEAD'].includes(request.method) ||
      (request.method === 'POST' && ['/rest/v1/rpc/submit_report', '/rest/v1/rpc/save_draft'].includes(path));
    try {
      return await fetcher(request.clone());
    } catch (error) {
      if (!retryable || request.signal.aborted || !isNetworkFailure(error)) throw error;
      return fetcher(request);
    }
  };
}
