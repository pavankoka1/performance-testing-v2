/**
 * System status (CPU, memory) for baseline comparison across devices.
 * Helps users know if their machine is under heavy load before recording.
 */
const si = require("systeminformation");

const CPU_WARN_THRESHOLD = 70; // % - warn if above this
const MEMORY_WARN_THRESHOLD = 85; // % - warn if above this

async function getSystemStatus() {
  try {
    const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);

    // CPU: use user+system to align with Activity Monitor / system monitor (excludes idle)
    const cpuPercent = Math.round(
      (cpu.currentLoadUser ?? 0) + (cpu.currentLoadSystem ?? 0) ||
        cpu.currentLoad
    );
    // Memory: use "active" (excl. cache) to align with Activity Monitor; "used" includes
    // file cache and often shows 95%+ on macOS even when plenty is available
    const memUsedPercent =
      mem.total > 0
        ? Math.round(((mem.active ?? mem.used) / mem.total) * 100)
        : 0;

    const isHighCpu = cpuPercent >= CPU_WARN_THRESHOLD;
    const isHighMemory = memUsedPercent >= MEMORY_WARN_THRESHOLD;
    const isHighLoad = isHighCpu || isHighMemory;

    return {
      cpuPercent,
      memoryPercent: memUsedPercent,
      memoryUsedMb: Math.round((mem.active ?? mem.used) / 1024 / 1024),
      memoryTotalMb: Math.round(mem.total / 1024 / 1024),
      isHighLoad,
      isHighCpu,
      isHighMemory,
      suggestion: isHighLoad
        ? "High machine load skews metrics. Close other apps for accurate results."
        : null,
    };
  } catch (err) {
    console.warn("[PerfTrace] system status failed:", err?.message);
    return {
      cpuPercent: null,
      memoryPercent: null,
      memoryUsedMb: null,
      memoryTotalMb: null,
      isHighLoad: false,
      isHighCpu: false,
      isHighMemory: false,
      suggestion: null,
      error: "Could not read system status.",
    };
  }
}

module.exports = { getSystemStatus, CPU_WARN_THRESHOLD, MEMORY_WARN_THRESHOLD };
