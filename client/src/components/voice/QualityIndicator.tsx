import { Component, Show } from 'solid-js';
import type { ConnectionMetrics } from '../../lib/webrtc/types';
import type { QualityLevel } from '../../lib/types';

interface QualityIndicatorProps {
  metrics: ConnectionMetrics | 'unknown' | null;
  mode: 'circle' | 'number';
  class?: string;
}

// Map semantic quality levels to visual colors
const qualityColors: Record<QualityLevel, string> = {
  good: 'bg-green-500',
  warning: 'bg-yellow-500',
  poor: 'bg-red-500',
  unknown: 'bg-gray-500',
};

const qualityTextColors: Record<QualityLevel, string> = {
  good: 'text-green-500',
  warning: 'text-yellow-500',
  poor: 'text-red-500',
  unknown: 'text-gray-500',
};

export const QualityIndicator: Component<QualityIndicatorProps> = (props) => {
  const isLoading = () => props.metrics === null || props.metrics === 'unknown';
  const metrics = () => (typeof props.metrics === 'object' ? props.metrics : null);

  return (
    <div class={`inline-flex items-center ${props.class ?? ''}`}>
      <Show
        when={!isLoading()}
        fallback={
          <div class="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        }
      >
        <Show
          when={props.mode === 'circle'}
          fallback={
            <span class={`text-xs font-mono ${qualityTextColors[metrics()!.quality]}`}>
              {metrics()!.latency}ms
            </span>
          }
        >
          <div
            class={`w-2 h-2 rounded-full ${qualityColors[metrics()!.quality]}`}
          />
        </Show>
      </Show>
    </div>
  );
};

export default QualityIndicator;
