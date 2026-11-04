(function attachEvidenceState(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.XPathAgentEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function createState() {
    return {
      pageIdentity: null,
      hostname: "",
      validatedAt: null,
      revision: 0,
      stale: false
    };
  }

  function markStale(state) {
    return { ...state, revision: state.revision + 1, stale: true };
  }

  function markValidated(state, page) {
    return {
      ...state,
      pageIdentity: page.identity,
      hostname: page.hostname,
      validatedAt: new Date().toISOString(),
      stale: false
    };
  }

  function isCurrent(state, page) {
    return Boolean(
      state &&
      !state.stale &&
      state.pageIdentity &&
      state.pageIdentity === page.identity
    );
  }

  function createValidationToken(state, pageIdentity, requestId) {
    return { pageIdentity, revision: state.revision, requestId };
  }

  function isValidationCurrent(token, state, pageIdentity, requestId) {
    return token.requestId === requestId &&
      token.revision === state.revision &&
      token.pageIdentity === pageIdentity;
  }

  function createRequestContext(requestId, page, state, selectedTargetIdentity, targetDescription) {
    return {
      requestId,
      tabId: page?.tabId || null,
      pageIdentity: page?.identity || null,
      evidenceRevision: state?.revision ?? 0,
      selectedTargetIdentity: selectedTargetIdentity || null,
      targetDescription: String(targetDescription || "")
    };
  }

  function isRequestCurrent(context, requestId, page, state, selectedTargetIdentity, targetDescription) {
    return context &&
      context.requestId === requestId &&
      context.tabId === (page?.tabId || null) &&
      context.pageIdentity === (page?.identity || null) &&
      context.evidenceRevision === (state?.revision ?? 0) &&
      context.selectedTargetIdentity === (selectedTargetIdentity || null) &&
      context.targetDescription === String(targetDescription || "");
  }

  return {
    createState,
    markStale,
    markValidated,
    isCurrent,
    createValidationToken,
    isValidationCurrent,
    createRequestContext,
    isRequestCurrent
  };
});
