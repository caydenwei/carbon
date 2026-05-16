import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef } from "react";
import { useCarbon } from "../CarbonContext";
import { toast } from "../Toast";

function formatSubscribeErr(err: unknown): string {
  if (err == null) return "No error details";
  if (typeof err === "string") return err.trim() || "No error details";
  if (err instanceof Error) return err.message || "No error details";
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface UseRealtimeChannelOptions<TDeps extends any[]> {
  topic: string;
  setup: (
    channel: RealtimeChannel,
    carbon: SupabaseClient,
    deps: TDeps
  ) => RealtimeChannel;
  enabled?: boolean;
  dependencies?: TDeps;
  /** When true, CHANNEL_ERROR / TIMED_OUT open a toast. Defaults to true in dev, false in prod. */
  notifyOnSubscribeError?: boolean;
}

export const useRealtimeChannel = <TDeps extends any[]>(
  options: UseRealtimeChannelOptions<TDeps>
) => {
  const {
    topic,
    setup,
    enabled = true,
    dependencies = [],
    notifyOnSubscribeError = process.env.NODE_ENV === "development"
  } = options;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isTearingDownRef = useRef(false);
  const lastErrorToastAtRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Updated each effect run so the retry timer always calls the latest subscribe closure.
  const doSubscribeRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const { carbon, isRealtimeAuthSet } = useCarbon();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const memoSetup = useCallback(setup, [topic, ...dependencies]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!carbon) return;

    // Define teardown inline - NOT in dependency array
    const teardown = async () => {
      if (isTearingDownRef.current) return;

      const channel = channelRef.current;
      if (!channel) return;

      isTearingDownRef.current = true;
      try {
        // Add timeout to prevent hanging indefinitely
        await Promise.race([
          carbon.removeChannel(channel),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Channel removal timeout")), 5000)
          )
        ]);
      } catch (error) {
        console.error(`Error removing channel ${topic}:`, error);
      } finally {
        channelRef.current = null;
        isTearingDownRef.current = false;
      }
    };

    if (!isRealtimeAuthSet || !enabled) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryCountRef.current = 0;
      void teardown();
      return;
    }

    const doSubscribe = async () => {
      // Ensure previous instance is gone before creating a new one
      if (channelRef.current) {
        await teardown();
      }

      try {
        const channel = carbon.channel(topic);
        const configuredChannel = memoSetup(
          channel,
          carbon,
          dependencies as TDeps
        );
        channelRef.current = configuredChannel;

        configuredChannel.subscribe(async (status, err) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            retryCountRef.current = 0;
            return;
          }

          const isRetriableError =
            status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT;

          if (isRetriableError && notifyOnSubscribeError) {
            const now = Date.now();
            if (now - lastErrorToastAtRef.current > 12_000) {
              lastErrorToastAtRef.current = now;
              toast.error(`Realtime disconnected (${topic})`, {
                description: `${status}: ${formatSubscribeErr(err)}`,
                duration: 10_000
              });
            }
          }

          if (isRetriableError) {
            await teardown();
            // Exponential backoff: 5s, 10s, 20s, 40s, 60s max
            const delay = Math.min(5_000 * 2 ** retryCountRef.current, 60_000);
            retryCountRef.current++;
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              void doSubscribeRef.current();
            }, delay);
          } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
            await teardown();
          }
        });
      } catch (error) {
        console.error(
          `Failed to subscribe to realtime channel ${topic}:`,
          error
        );
        if (notifyOnSubscribeError) {
          toast.error(`Realtime setup failed (${topic})`, {
            description:
              error instanceof Error ? error.message : formatSubscribeErr(error)
          });
        }
      }
    };

    // Keep ref up-to-date so retry timers always call the latest closure.
    doSubscribeRef.current = doSubscribe;
    void doSubscribe();

    // Cleanup on unmount or dependency change
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryCountRef.current = 0;
      void teardown();
    };
  }, [
    carbon,
    isRealtimeAuthSet,
    enabled,
    topic,
    memoSetup,
    notifyOnSubscribeError
    // teardown/doSubscribe are NOT in dependencies - defined inline
  ]);

  return channelRef;
};
