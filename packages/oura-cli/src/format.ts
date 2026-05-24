/**
 * Plain-text formatters for the Oura API responses.
 * Identical output to the upstream `oura-cli` for parity.
 */

export function formatDate(d: string): string {
  return d || "N/A";
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "N/A";
  return `${score}/100`;
}

export function formatMinutes(mins: number | null | undefined): string {
  if (mins == null) return "N/A";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatSeconds(secs: number | null | undefined): string {
  if (secs == null) return "N/A";
  return formatMinutes(Math.round(secs / 60));
}

export function formatPersonalInfo(d: any): string {
  return [
    "── Personal Info ──",
    `  Age:    ${d.age ?? "N/A"}`,
    `  Weight: ${d.weight ? d.weight + " kg" : "N/A"}`,
    `  Height: ${d.height ? d.height + " m" : "N/A"}`,
    `  Sex:    ${d.biological_sex ?? "N/A"}`,
    `  Email:  ${d.email ?? "N/A"}`,
  ].join("\n");
}

export function formatDailyActivity(items: any[]): string {
  if (!items.length) return "No activity data found for this period.";
  return items
    .map((d) =>
      [
        `── Activity: ${formatDate(d.day)} ──`,
        `  Score:             ${formatScore(d.score)}`,
        `  Active Calories:   ${d.active_calories ?? "N/A"} kcal`,
        `  Total Calories:    ${d.total_calories ?? "N/A"} kcal`,
        `  Steps:             ${d.steps?.toLocaleString() ?? "N/A"}`,
        `  Equivalent Walking Distance: ${d.equivalent_walking_distance ? Math.round(d.equivalent_walking_distance) + " m" : "N/A"}`,
        `  High Activity:     ${formatMinutes(d.high_activity_time ? Math.round(d.high_activity_time / 60) : null)}`,
        `  Medium Activity:   ${formatMinutes(d.medium_activity_time ? Math.round(d.medium_activity_time / 60) : null)}`,
        `  Low Activity:      ${formatMinutes(d.low_activity_time ? Math.round(d.low_activity_time / 60) : null)}`,
        `  Sedentary Time:    ${formatMinutes(d.sedentary_time ? Math.round(d.sedentary_time / 60) : null)}`,
        `  Resting Time:      ${formatMinutes(d.resting_time ? Math.round(d.resting_time / 60) : null)}`,
        `  MET Minutes:       ${d.met?.average_met ? d.met.average_met.toFixed(1) : "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatDailyReadiness(items: any[]): string {
  if (!items.length) return "No readiness data found for this period.";
  return items
    .map((d) => {
      const c = d.contributors || {};
      return [
        `── Readiness: ${formatDate(d.day)} ──`,
        `  Score:                    ${formatScore(d.score)}`,
        `  Temperature Deviation:    ${d.temperature_deviation != null ? d.temperature_deviation.toFixed(2) + "°C" : "N/A"}`,
        `  Temperature Trend:        ${d.temperature_trend_deviation != null ? d.temperature_trend_deviation.toFixed(2) + "°C" : "N/A"}`,
        `  Contributors:`,
        `    Activity Balance:       ${formatScore(c.activity_balance)}`,
        `    Body Temperature:       ${formatScore(c.body_temperature)}`,
        `    HRV Balance:            ${formatScore(c.hrv_balance)}`,
        `    Previous Day Activity:  ${formatScore(c.previous_day_activity)}`,
        `    Previous Night:         ${formatScore(c.previous_night)}`,
        `    Recovery Index:         ${formatScore(c.recovery_index)}`,
        `    Resting Heart Rate:     ${formatScore(c.resting_heart_rate)}`,
        `    Sleep Balance:          ${formatScore(c.sleep_balance)}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function formatDailySleep(items: any[]): string {
  if (!items.length) return "No daily sleep data found for this period.";
  return items
    .map((d) => {
      const c = d.contributors || {};
      return [
        `── Daily Sleep: ${formatDate(d.day)} ──`,
        `  Score:           ${formatScore(d.score)}`,
        `  Contributors:`,
        `    Deep Sleep:    ${formatScore(c.deep_sleep)}`,
        `    Efficiency:    ${formatScore(c.efficiency)}`,
        `    Latency:       ${formatScore(c.latency)}`,
        `    REM Sleep:     ${formatScore(c.rem_sleep)}`,
        `    Restfulness:   ${formatScore(c.restfulness)}`,
        `    Timing:        ${formatScore(c.timing)}`,
        `    Total Sleep:   ${formatScore(c.total_sleep)}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function formatSleep(items: any[]): string {
  if (!items.length) return "No sleep period data found for this period.";
  return items
    .map((d) =>
      [
        `── Sleep Period: ${formatDate(d.day)} ──`,
        `  Type:            ${d.type ?? "N/A"}`,
        `  Bedtime Start:   ${d.bedtime_start ?? "N/A"}`,
        `  Bedtime End:     ${d.bedtime_end ?? "N/A"}`,
        `  Total Duration:  ${formatSeconds(d.total_sleep_duration)}`,
        `  Time in Bed:     ${formatSeconds(d.time_in_bed)}`,
        `  Deep Sleep:      ${formatSeconds(d.deep_sleep_duration)}`,
        `  REM Sleep:       ${formatSeconds(d.rem_sleep_duration)}`,
        `  Light Sleep:     ${formatSeconds(d.light_sleep_duration)}`,
        `  Awake Time:      ${formatSeconds(d.awake_time)}`,
        `  Efficiency:      ${d.efficiency != null ? d.efficiency + "%" : "N/A"}`,
        `  Latency:         ${formatSeconds(d.latency)}`,
        `  Avg Heart Rate:  ${d.average_heart_rate != null ? d.average_heart_rate.toFixed(1) + " bpm" : "N/A"}`,
        `  Lowest HR:       ${d.lowest_heart_rate != null ? d.lowest_heart_rate + " bpm" : "N/A"}`,
        `  Avg HRV (RMSSD): ${d.average_hrv != null ? Math.round(d.average_hrv) + " ms" : "N/A"}`,
        `  Restless Periods:${d.restless_periods ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatDailySpo2(items: any[]): string {
  if (!items.length) return "No SpO2 data found for this period.";
  return items
    .map((d) =>
      [
        `── SpO2: ${formatDate(d.day)} ──`,
        `  Average: ${d.spo2_percentage?.average != null ? d.spo2_percentage.average + "%" : "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatDailyStress(items: any[]): string {
  if (!items.length) return "No stress data found for this period.";
  return items
    .map((d) =>
      [
        `── Stress: ${formatDate(d.day)} ──`,
        `  Stress High:    ${d.stress_high ?? "N/A"} min`,
        `  Recovery High:  ${d.recovery_high ?? "N/A"} min`,
        `  Day Summary:    ${d.day_summary ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatHeartRate(items: any[]): string {
  if (!items.length) return "No heart rate data found for this period.";
  const lines = ["── Heart Rate ──"];
  for (const d of items) {
    lines.push(`  ${d.timestamp}  ${d.bpm} bpm  (${d.source ?? "unknown"})`);
  }
  const bpms = items.map((d) => d.bpm).filter((b: number) => b != null);
  if (bpms.length) {
    const min = Math.min(...bpms);
    const max = Math.max(...bpms);
    const avg = (bpms.reduce((a: number, b: number) => a + b, 0) / bpms.length).toFixed(1);
    lines.push("");
    lines.push(`  Summary: ${bpms.length} readings, Min ${min} bpm, Max ${max} bpm, Avg ${avg} bpm`);
  }
  return lines.join("\n");
}

export function formatWorkout(items: any[]): string {
  if (!items.length) return "No workout data found for this period.";
  return items
    .map((d) =>
      [
        `── Workout: ${formatDate(d.day)} ──`,
        `  Activity:   ${d.activity ?? "N/A"}`,
        `  Start:      ${d.start_datetime ?? "N/A"}`,
        `  End:        ${d.end_datetime ?? "N/A"}`,
        `  Duration:   ${formatSeconds(d.duration)}`,
        `  Calories:   ${d.calories != null ? d.calories + " kcal" : "N/A"}`,
        `  Distance:   ${d.distance != null ? (d.distance / 1000).toFixed(2) + " km" : "N/A"}`,
        `  Intensity:  ${d.intensity ?? "N/A"}`,
        `  Source:     ${d.source ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatSession(items: any[]): string {
  if (!items.length) return "No session data found for this period.";
  return items
    .map((d) =>
      [
        `── Session: ${formatDate(d.day)} ──`,
        `  Type:       ${d.type ?? "N/A"}`,
        `  Mood:       ${d.mood ?? "N/A"}`,
        `  Start:      ${d.start_datetime ?? "N/A"}`,
        `  End:        ${d.end_datetime ?? "N/A"}`,
        `  Avg HR:     ${d.average_heart_rate != null ? d.average_heart_rate + " bpm" : "N/A"}`,
        `  Avg HRV:    ${d.average_hrv != null ? Math.round(d.average_hrv) + " ms" : "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatEnhancedTag(items: any[]): string {
  if (!items.length) return "No tag data found for this period.";
  return items
    .map((d) =>
      [
        `── Tag: ${formatDate(d.day)} ──`,
        `  Tag:      ${d.tag_type_code ?? "N/A"}`,
        `  Time:     ${d.timestamp ?? "N/A"}`,
        `  Comment:  ${d.comment || "none"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatRingConfig(items: any[]): string {
  if (!items.length) return "No ring configuration data found.";
  return items
    .map((d) =>
      [
        `── Ring Configuration ──`,
        `  Color:            ${d.color ?? "N/A"}`,
        `  Design:           ${d.design ?? "N/A"}`,
        `  Firmware:         ${d.firmware_version ?? "N/A"}`,
        `  Hardware Type:    ${d.hardware_type ?? "N/A"}`,
        `  Set Up Date:      ${d.set_up_at ?? "N/A"}`,
        `  Size:             ${d.size ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatRestMode(items: any[]): string {
  if (!items.length) return "No rest mode data found for this period.";
  return items
    .map((d) =>
      [
        `── Rest Mode: ${formatDate(d.day ?? d.start_day)} ──`,
        `  Start:    ${d.start_day ?? "N/A"}`,
        `  End:      ${d.end_day ?? "ongoing"}`,
        `  End Date: ${d.end_date ?? "ongoing"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatSleepTime(items: any[]): string {
  if (!items.length) return "No sleep time recommendation data found for this period.";
  return items
    .map((d) =>
      [
        `── Sleep Time: ${formatDate(d.day)} ──`,
        `  Optimal Bedtime:`,
        `    Start:  ${d.recommendation?.optimal_bedtime?.start ?? "N/A"}`,
        `    End:    ${d.recommendation?.optimal_bedtime?.end ?? "N/A"}`,
        `  Status:   ${d.status ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatDailyCardiovascularAge(items: any[]): string {
  if (!items.length) return "No cardiovascular age data found for this period.";
  return items
    .map((d) =>
      [
        `── Cardiovascular Age: ${formatDate(d.day)} ──`,
        `  Vascular Age: ${d.vascular_age ?? "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatDailyResilience(items: any[]): string {
  if (!items.length) return "No resilience data found for this period.";
  return items
    .map((d) => {
      const c = d.contributors || {};
      return [
        `── Resilience: ${formatDate(d.day)} ──`,
        `  Level:                ${d.level ?? "N/A"}`,
        `  Contributors:`,
        `    Sleep Recovery:     ${formatScore(c.sleep_recovery)}`,
        `    Daytime Recovery:   ${formatScore(c.daytime_recovery)}`,
        `    Stress:             ${formatScore(c.stress)}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function formatVo2Max(items: any[]): string {
  if (!items.length) return "No VO2 max data found for this period.";
  return items
    .map((d) =>
      [
        `── VO2 Max: ${formatDate(d.day)} ──`,
        `  VO2 Max: ${d.vo2_max != null ? d.vo2_max.toFixed(1) + " mL/kg/min" : "N/A"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatList(data: any, formatter: (items: any[]) => string): string {
  const items = data?.data ?? [];
  const result = formatter(items);
  const next = data?.next_token;
  if (next) {
    return result + `\n\n(More data available — use --next-token ${next})`;
  }
  return result;
}
