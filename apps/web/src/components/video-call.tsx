"use client";

/**
 * OFİS İÇİ GÖRÜNTÜLÜ ARAMA — WebRTC, HTTP-polling sinyalleşmeli.
 *
 * UÇLAR (hazır; OfficeCall/OfficeCallSignal):
 *   POST /chat/calls                — ara (RINGING)
 *   GET  /chat/calls/incoming       — gelen çağrı yoklaması (2 sn)
 *   POST /chat/calls/:id/accept     — aç (ACTIVE)
 *   POST /chat/calls/:id/reject    — reddet
 *   POST /chat/calls/:id/end       — kapat
 *   POST /chat/calls/:id/signals   — OFFER/ANSWER/CANDIDATE gönder
 *   GET  /chat/calls/:id/signals?after= — sinyalleri çek (1.5 sn)
 *
 * SINIRLAR (dürüst): yalnız genel STUN (Google) kullanılır — TURN yoktur.
 * Sıkı NAT arkasındaki iki uç arasında bağlantı kurulamayabilir; sesli arama
 * hatası durumunda mesajlaşma kullanılabilir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export interface IncomingCall {
  callId: string;
  from: { id: string; fullName: string };
  createdAt: string;
}

type CallPhase = "ringing-out" | "ringing-in" | "active" | "ended" | "failed";

export function useVideoCall(myUserId: string | undefined) {
  const [phase, setPhase] = useState<CallPhase | null>(null);
  const [peerName, setPeerName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const lastSignalAtRef = useRef<string | undefined>(undefined);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const roleRef = useRef<"caller" | "callee">("caller");
  const lastSignalIdRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    callIdRef.current = null;
    lastSignalAtRef.current = undefined;
    lastSignalIdRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setPhase(null);
    setPeerName("");
  }, []);

  /** Sinyal gönder (offer/answer/candidate). */
  const postSignal = useCallback(async (kind: "OFFER" | "ANSWER" | "CANDIDATE", payload: unknown) => {
    const callId = callIdRef.current;
    if (!callId) return;
    await api(`/chat/calls/${callId}/signals`, {
      method: "POST",
      body: { kind, payload: JSON.stringify(payload) },
    }).catch(() => undefined);
  }, []);

  /** Peer bağlantısı kur + yerel medyayı bağla. */
  const createPeer = useCallback(async (): Promise<RTCPeerConnection> => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (ev) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = ev.streams[0];
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void postSignal("CANDIDATE", ev.candidate.toJSON());
    };
    return pc;
  }, [postSignal]);

  /** Karşı sinyalleri işle (answer + candidate — caller için). */
  const processSignals = useCallback(
    async (signals: Array<{ id: string; kind: string; payload: string }>) => {
      const pc = pcRef.current;
      if (!pc) return;
      for (const s of signals) {
        if (s.id === lastSignalIdRef.current) continue;
        lastSignalIdRef.current = s.id;
        const data = JSON.parse(s.payload) as unknown;
        try {
          if (s.kind === "ANSWER") {
            await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          } else if (s.kind === "OFFER" && roleRef.current === "callee") {
            await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await postSignal("ANSWER", answer);
          } else if (s.kind === "CANDIDATE") {
            await pc.addIceCandidate(data as RTCIceCandidateInit);
          }
        } catch {
          /* yarış durumu — sonraki sinyal düzeltir */
        }
      }
    },
    [postSignal],
  );

  /** Giden çağrı: arama başlat → offer gönder → durum+sinyal yokla. */
  const startCall = useCallback(
    async (calleeId: string, name: string) => {
      setError(null);
      try {
        const res = await api<{ callId: string }>("/chat/calls", {
          method: "POST",
          body: { calleeId },
        });
        callIdRef.current = res.callId;
        roleRef.current = "caller";
        setPeerName(name);
        setPhase("ringing-out");

        const pc = await createPeer();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postSignal("OFFER", offer);

        // Yoklama: durum + sinyaller (yanıt gelene dek).
        const poll = setInterval(async () => {
          const callId = callIdRef.current;
          if (!callId) {
            clearInterval(poll);
            return;
          }
          try {
            const st = await api<{ status: string }>(`/chat/calls/${callId}`);
            if (st.status === "ACTIVE") setPhase("active");
            if (st.status === "ENDED" || st.status === "REJECTED" || st.status === "MISSED") {
              clearInterval(poll);
              setPhase(st.status === "REJECTED" ? "ended" : st.status === "ENDED" ? "ended" : "ended");
              setError(st.status === "REJECTED" ? "Arama reddedildi." : null);
              cleanup();
            }
            const sig = await api<{ signals: Array<{ id: string; kind: string; payload: string; createdAt: string }> }>(
              `/chat/calls/${callId}/signals`,
              { query: lastSignalAtRef.current ? { after: lastSignalAtRef.current } : undefined },
            );
            if (sig.signals.length > 0) {
              lastSignalAtRef.current = sig.signals[sig.signals.length - 1].createdAt;
              await processSignals(sig.signals);
            }
          } catch {
            /* geçici yoklama hatası sessiz geçer */
          }
        }, 2000);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Arama başlatılamadı.");
        cleanup();
      }
    },
    [cleanup, createPeer, postSignal, processSignals],
  );

  /** Gelen aramayı kabul et: ACTIVE + offer'ı işle + answer dön. */
  const acceptCall = useCallback(
    async (call: IncomingCall) => {
      setError(null);
      try {
        await api(`/chat/calls/${call.callId}/accept`, { method: "POST" });
        callIdRef.current = call.callId;
        roleRef.current = "callee";
        setPeerName(call.from.fullName);
        setPhase("active");
        setIncoming(null);

        await createPeer();
        // OFFER sinyalini çek ve işle (processSignals answer döner).
        const poll = setInterval(async () => {
          const callId = callIdRef.current;
          if (!callId) {
            clearInterval(poll);
            return;
          }
          try {
            const sig = await api<{ signals: Array<{ id: string; kind: string; payload: string; createdAt: string }> }>(
              `/chat/calls/${callId}/signals`,
              { query: lastSignalAtRef.current ? { after: lastSignalAtRef.current } : undefined },
            );
            if (sig.signals.length > 0) {
              lastSignalAtRef.current = sig.signals[sig.signals.length - 1].createdAt;
              await processSignals(sig.signals);
            }
            const st = await api<{ status: string }>(`/chat/calls/${callId}`);
            if (st.status === "ENDED") {
              clearInterval(poll);
              cleanup();
            }
          } catch {
            /* sessiz */
          }
        }, 1500);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Arama açılamadı.");
        cleanup();
      }
    },
    [cleanup, createPeer, processSignals],
  );

  const rejectCall = useCallback(async (call: IncomingCall) => {
    await api(`/chat/calls/${call.callId}/reject`, { method: "POST" }).catch(() => undefined);
    setIncoming(null);
  }, []);

  const endCall = useCallback(async () => {
    const callId = callIdRef.current;
    if (callId) {
      await api(`/chat/calls/${callId}/end`, { method: "POST" }).catch(() => undefined);
    }
    cleanup();
  }, [cleanup]);

  /** Gelen çağrı yoklaması — sayfa açıkken 3 sn'de bir. */
  useEffect(() => {
    if (!myUserId || phase) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const rows = await api<IncomingCall[]>("/chat/calls/incoming");
        if (alive && Array.isArray(rows) && rows.length > 0) {
          setIncoming(rows[0]);
        } else if (alive) {
          setIncoming(null);
        }
      } catch {
        /* sessiz */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [myUserId, phase]);

  return {
    phase,
    peerName,
    error,
    incoming,
    localVideoRef,
    remoteVideoRef,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
  };
}
