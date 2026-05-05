export type AiFeature = 'chat' | 'video';
export type AiGatewayMode = 'auto' | 'byo' | 'hosted';
export type AiAccessResultMode = 'byo' | 'hosted' | 'unavailable';

export interface AiAccessInput {
  byoAvailable?: boolean;
  feature: AiFeature;
  hostedAvailable?: boolean;
  requestedMode?: AiGatewayMode;
}

export interface AiAccessDecision {
  byoAvailable: boolean;
  feature: AiFeature;
  hostedAvailable: boolean;
  mode: AiAccessResultMode;
  reason: string;
  requestedMode: AiGatewayMode;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

export function resolveAiAccess(input: AiAccessInput): AiAccessDecision {
  const hostedAvailable = toBoolean(input.hostedAvailable);
  const byoAvailable = toBoolean(input.byoAvailable);
  const requestedMode = input.requestedMode ?? 'auto';

  if (requestedMode === 'hosted') {
    return hostedAvailable
      ? {
          byoAvailable,
          feature: input.feature,
          hostedAvailable,
          mode: 'hosted',
          reason: 'Hosted AI is available and was explicitly requested.',
          requestedMode,
        }
      : {
          byoAvailable,
          feature: input.feature,
          hostedAvailable,
          mode: 'unavailable',
          reason: 'Hosted AI was requested but is not available for this context.',
          requestedMode,
        };
  }

  if (requestedMode === 'byo') {
    return byoAvailable
      ? {
          byoAvailable,
          feature: input.feature,
          hostedAvailable,
          mode: 'byo',
          reason: 'BYO mode was explicitly requested and is available.',
          requestedMode,
        }
      : {
          byoAvailable,
          feature: input.feature,
          hostedAvailable,
          mode: 'unavailable',
          reason: 'BYO mode was requested but no provider key is configured.',
          requestedMode,
        };
  }

  if (hostedAvailable) {
    return {
      byoAvailable,
      feature: input.feature,
      hostedAvailable,
      mode: 'hosted',
      reason: 'Hosted AI is available and selected by the central decision layer.',
      requestedMode,
    };
  }

  if (byoAvailable) {
    return {
      byoAvailable,
      feature: input.feature,
      hostedAvailable,
      mode: 'byo',
      reason: 'Hosted AI is unavailable, so the decision layer falls back to BYO mode.',
      requestedMode,
    };
  }

  return {
    byoAvailable,
    feature: input.feature,
    hostedAvailable,
    mode: 'unavailable',
    reason: 'Neither hosted AI nor BYO provider credentials are available.',
    requestedMode,
  };
}

export function isHostedAiDecision(decision: AiAccessDecision): boolean {
  return decision.mode === 'hosted';
}

export function isByoAiDecision(decision: AiAccessDecision): boolean {
  return decision.mode === 'byo';
}
