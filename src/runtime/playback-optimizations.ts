// Vite folds the selected A/B variant. Other hosts use the production defaults.
declare const __SENREN_CONTINUOUS_OPUS__: boolean;
declare const __SENREN_DIRECT_TRANSITIONS__: boolean;
export const continuousOpus = typeof __SENREN_CONTINUOUS_OPUS__ === 'undefined' || __SENREN_CONTINUOUS_OPUS__;
export const directTransitions = typeof __SENREN_DIRECT_TRANSITIONS__ === 'undefined' || __SENREN_DIRECT_TRANSITIONS__;
