import { extractTaxonomy } from "./concept-extractor";

import { matchFuzzyConcepts } from "./fuzzy-matcher";

import { interpretPhrases } from "./phrase-interpreter";

import { composeScene } from "./scene-composer";

import { translateMusicBehaviour } from "./music-translator";

import { applyRichKnowledge } from "./apply-rich-knowledge";

import { applyUniversalKnowledge } from "./apply-universal-knowledge";

import { applyConceptGraph } from "./apply-concept-graph";

import { buildEmotionalSceneGraph } from "./scene-graph";

import { resolveIntentContract } from "./intent-contract";

import { applyNegation } from "./negation";

import {
  buildSceneConfidenceExplanation,
  interpretMoment,
} from "./moment-interpreter";

import { buildSemanticMomentFingerprint } from "./moment-representation";

import { buildExperienceFingerprint } from "./experience-fingerprint";

import { reasonAboutExperience } from "./experience-reasoning";

import { buildHumanExperience } from "./human-experience-engine";

import { buildEmotionalArc } from "./emotional-arc";

import { applyMusicalBehavioursToModel } from "./musical-behaviour-match";

import {
  applyAmbiguousResolution,
  applyAtlasTaxonomyBoost,
  resolveAmbiguousPrompt,
} from "./ambiguous-prompt-resolver";

import { enrichTaxonomyFromAtlas } from "./atlas-loader";

import type { WorldUnderstandingResult } from "./types";



function buildHumanNarrative(

  sceneLabel: string,

  emotions: string[],

  environment: string[],

  humanMeanings: string[],

): string {

  const meaning = humanMeanings[0];

  if (meaning) return meaning;

  const emo = emotions.slice(0, 3).join(", ") || "quiet reflection";

  const env = environment.slice(0, 3).join(", ") || "an unspoken place";

  return `${sceneLabel} — ${env}. Feeling: ${emo}.`;

}



function computeConfidence(

  phraseCount: number,

  fuzzyCount: number,

  conceptCount: number,

  sceneScore: number,

): number {

  const phraseBoost = Math.min(phraseCount * 0.12, 0.36);

  const fuzzyBoost = Math.min(fuzzyCount * 0.08, 0.24);

  const conceptBoost = Math.min(conceptCount * 0.04, 0.28);

  const sceneBoost = Math.min(sceneScore / 100, 0.4);

  return Math.round(Math.min(0.98, 0.22 + phraseBoost + fuzzyBoost + conceptBoost + sceneBoost) * 100) / 100;

}



function pushUnique(target: string[], values: string[]): void {

  for (const v of values) {

    if (!target.includes(v)) target.push(v);

  }

}



/**

 * Intermediate interpretation layer: prompt → human meaning → music behaviour.

 * Sits before playlist scoring; does not replace scene bus or canonicalizer.

 */

export function interpretWorld(prompt: string): WorldUnderstandingResult {

  const text = prompt.trim();

  const intent = resolveIntentContract(text);

  const phraseMatches = interpretPhrases(text);

  const fuzzy = matchFuzzyConcepts(text);

  const { taxonomy: baseTaxonomy, matchedConceptIds: baseIds } = extractTaxonomy(

    text,

    phraseMatches,

    fuzzy.expansions,

  );



  const rich = applyRichKnowledge(text, baseTaxonomy, baseIds);

  const universal = applyUniversalKnowledge(text, rich.taxonomy);

  const graph = applyConceptGraph(text, universal.taxonomy);

  const negation = applyNegation(text, graph.taxonomy);



  const taxonomy = negation.taxonomy;
  pushUnique(taxonomy.emotion, intent.emotionBoosts);

  const ambiguousResolution = resolveAmbiguousPrompt(text);
  applyAmbiguousResolution(taxonomy, ambiguousResolution);
  pushUnique(taxonomy.emotion, ambiguousResolution.emotionBoosts);

  const matchedConceptIds = rich.matchedConceptIds;

  const momentInterpretation = interpretMoment(text, taxonomy, matchedConceptIds, intent);
  pushUnique(taxonomy.emotion, momentInterpretation.emotionBoosts);

  if (ambiguousResolution.suppressWeatherReflection) {
    momentInterpretation.weatherIsSecondary = true;
  }

  if (intent.stressRecovery) {
    pushUnique(taxonomy.lifeContext, ["difficult period", "transition"]);
    pushUnique(taxonomy.emotion, ["exhaustion", "relief", "reflection"]);
    if (!matchedConceptIds.lifeContext) matchedConceptIds.lifeContext = [];
    pushUnique(matchedConceptIds.lifeContext, ["difficult_period", "transition"]);
  }

  const experienceFingerprint = buildExperienceFingerprint(text, taxonomy, intent);

  const summerTransitionHint = momentInterpretation.lifeEvents.some(
    (e) => e.category === "transition" && /summer/i.test(e.trigger),
  )
    ? ["SUMMER_TRANSITION"]
    : [];

  const sceneHints = [
    ...summerTransitionHint,
    ...momentInterpretation.sceneHints,
    ...(intent.preferredScenes ?? []),
    ...graph.sceneHints,
    ...(rich.sceneHint ? [rich.sceneHint] : []),
    ...(universal.sceneHint ? [universal.sceneHint] : []),
    ...(fuzzy.sceneHint ? [fuzzy.sceneHint] : []),
    ...ambiguousResolution.sceneHints,
  ].filter((h, i, arr) => arr.indexOf(h) === i);

  const humanMeanings = [
    ...ambiguousResolution.humanMeanings,
    ...graph.humanMeanings,
    ...universal.humanMeanings,
  ].filter(

    (m, i, arr) => arr.indexOf(m) === i,

  ).slice(0, 4);

  const humanExperience = buildHumanExperience({
    prompt: text,
    fingerprint: experienceFingerprint,
    taxonomy,
    intent,
    momentInterpretation,
    humanMeanings,
    graphExperiences: graph.experiences,
  });
  const emotionalArc = buildEmotionalArc(humanExperience);

  const composed = composeScene(taxonomy, matchedConceptIds, sceneHints[0], {
    sceneHints,
    graphSceneHints: graph.sceneHints,
    intent,
    momentInterpretation,
  });

  const { candidates, ...scene } = composed;

  enrichTaxonomyFromAtlas(text, taxonomy);
  applyAtlasTaxonomyBoost(text, experienceFingerprint, taxonomy);

  const sceneConfidence = buildSceneConfidenceExplanation(
    scene.id,
    scene.label,
    scene.humanSummary,
    scene.score,
    candidates.map((c) => ({
      id: c.id,
      label: c.label,
      score: c.score,
      momentReasons: c.momentReasons,
    })),
    momentInterpretation,
  );

  const experienceReasoning = reasonAboutExperience(text, taxonomy, momentInterpretation);



  let musicBehaviour = translateMusicBehaviour(scene, phraseMatches);
  musicBehaviour = applyMusicalBehavioursToModel(musicBehaviour, humanExperience, 0.24);
  if (emotionalArc.phases.length > 0 && humanExperience.playlistIntent === "recover") {
    const openingEmotion = emotionalArc.phases[0]?.emotion ?? "";
    if (/exhaustion|grief|stress/i.test(openingEmotion)) {
      musicBehaviour = { ...musicBehaviour, energy: Math.min(musicBehaviour.energy, 0.42) };
    }
  }

  const sceneGraph = buildEmotionalSceneGraph(taxonomy, scene, musicBehaviour);



  const matchedConcepts = [

    ...phraseMatches.map((p) => `phrase:${p.phrase}`),

    ...fuzzy.expansions.map((e) => `fuzzy:${e.id}`),

    ...rich.matchedConcepts,

    ...universal.matchedConcepts,

    ...graph.matchedConcepts,

    ...negation.notes.map((n) => `negation:${n}`),

    ...(intent.trigger ? [`intent:${intent.kind}`] : []),

    ...Object.entries(matchedConceptIds).flatMap(([cat, ids]) =>

      ids.map((id) => `${cat}:${id}`),

    ),

  ].slice(0, 40);



  const conceptCount =

    taxonomy.environment.length +

    taxonomy.activity.length +

    taxonomy.emotion.length +

    taxonomy.social.length +

    taxonomy.lifeContext.length +

    taxonomy.sensory.length;



  const confidence = computeConfidence(

    phraseMatches.length + rich.situationMatches.length + universal.matches.length + graph.matches.length,

    fuzzy.expansions.length,

    conceptCount,

    scene.score,

  );



  const humanNarrative =
    humanExperience.narrative ||
    buildHumanNarrative(
      scene.label,
      taxonomy.emotion,
      taxonomy.environment,
      humanMeanings,
    );

  const semanticMoment = buildSemanticMomentFingerprint({
    prompt: text,
    taxonomy,
    matchedConceptIds,
    momentInterpretation,
    intent,
    graphMatches: graph.matches,
    scene,
    sceneCandidates: candidates,
    musicBehaviour,
    humanMeanings,
    worldConfidence: confidence,
  });



  return {

    prompt: text,

    taxonomy,

    semanticMoment,

    scene,

    sceneGraph,

    musicBehaviour,

    matchedPhrases: phraseMatches,

    fuzzyExpansions: fuzzy.expansions,

    humanNarrative,

    humanMeanings,

    confidence,

    humanExperience,

    emotionalArc,

    debug: {

      matchedConceptIds,

      paraphraseCluster: fuzzy.paraphraseCluster,

      matchedConcepts,

      graphExperiences: graph.experiences,

      graphMatches: graph.matches.map((m) => ({

        id: m.node.id,

        domain: m.node.domain,

        cue: m.matchedCue,

      })),

      intent: {

        kind: intent.kind,

        confidence: intent.confidence,

        trigger: intent.trigger,

      },

      sceneCandidates: candidates,

      momentInterpretation: {
        dominantStory: momentInterpretation.dominantStory,
        narrativeDominance: momentInterpretation.narrativeDominance,
        weatherIsSecondary: momentInterpretation.weatherIsSecondary,
        primaryConcepts: momentInterpretation.primaryConcepts.map((c) => ({
          label: c.label,
          category: c.category,
          physical: c.physical,
          emotional: c.emotional,
          narrative: c.narrative,
        })),
        lifeEvents: momentInterpretation.lifeEvents.map((e) => ({
          category: e.category,
          trigger: e.trigger,
        })),
        temporal: momentInterpretation.temporal.map((t) => ({
          phase: t.phase,
          trigger: t.trigger,
        })),
      },

      sceneConfidence,

      semanticFingerprint: experienceFingerprint,

      emotionalArc,

      humanExperience: {
        inferredQualities: humanExperience.inferredQualities,
        sharedMemories: humanExperience.sharedMemories,
        playlistIntent: humanExperience.playlistIntent,
        musicalBehaviours: humanExperience.musicalBehaviours,
        narrative: humanExperience.narrative,
        emotionalArcSummary: humanExperience.emotionalArcSummary,
        atlasConsultations: humanExperience.atlasConsultations,
        interpretationReasons: humanExperience.interpretationReasons,
      },

      experienceReasoning: {
        chains: experienceReasoning.chains,
        hops: experienceReasoning.hops.map((h) => `${h.from} → ${h.to}`),
        prioritizedConcepts: experienceReasoning.prioritizedConcepts,
        alternativeInterpretations: experienceReasoning.alternativeInterpretations,
        confidence: experienceReasoning.confidence,
      },

    },

  };

}



export { applyWorldUnderstandingToProfile } from "./apply-profile";

export { buildWorldUnderstandingDebug } from "./debug";

export type { WorldUnderstandingResult } from "./types";

export type { WorldUnderstandingDebugView } from "./debug";

export type { SemanticMomentFingerprint } from "./moment-representation";

export { buildSemanticMomentFingerprint, summariseFingerprintDimensions } from "./moment-representation";

export { runSemanticMomentEval, evaluateGoldenPrompt } from "./semantic-eval";

export type { EmotionalSceneGraph } from "./scene-graph";


