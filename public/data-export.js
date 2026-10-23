(function (root) {
  function warmupRecord(saved) {
    if (!saved || !Array.isArray(saved.history)) return null;
    return {
      phase: "warmup", childId: null,
      startTime: saved.startedAt || saved.history.find(item => item.at)?.at || null,
      endTime: saved.endedAt || new Date().toISOString(),
      chatHistory: saved.history.map(item => ({ ...item })),
      pageEvents: Array.isArray(saved.pageEvents) ? saved.pageEvents : [],
      errors: Array.isArray(saved.errors) ? saved.errors : [],
    };
  }
  function combinedExport(data = {}) {
    return {
      ...data, schemaVersion: 2, phase: "formal", exportedAt: new Date().toISOString(),
      warmup: data.warmup ? { ...data.warmup, childId: data.childId || data.warmup.childId || null } : null,
    };
  }
  root.XiaoxingData = { warmupRecord, combinedExport };
})(globalThis);
