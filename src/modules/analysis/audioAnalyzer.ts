// TEMP DISABLED ANALYSIS FOR SUPERPOWERED MIGRATION

export type AudioAnalysisResult = {
  status: "disabled";
};

export async function analyzeAudio(): Promise<AudioAnalysisResult> {
  console.log("Audio analysis disabled (Superpowered migration)");
  return {
    status: "disabled",
  };
}
