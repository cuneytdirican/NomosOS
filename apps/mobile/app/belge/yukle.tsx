/**
 * Belge yükleme (Faz 7E): kamera / galeri / dosya seçici → dosyaya yükle.
 *
 * Yüklenen belge sunucuda normal belge hattından geçer (hash, kota, OCR, sınıflandırma,
 * aksiyon önerileri). Taranmış görüntü OCR'a girer; metin çıkarımı sunucuda yapılır.
 * Cihazda kopya tutulmaz; yükleme bitince önizleme temizlenir.
 */

import React, { useCallback, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { errorMessage } from "@/api/client";
import { uploadDocument, type UploadResult } from "@/api/endpoints";
import { useOnline } from "@/net/connectivity";
import { Body, Button, Card, Muted, ScrollScreen, Section, H2 } from "@/ui/components";
import { colors, space } from "@/ui/theme";

interface Picked {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  isImage: boolean;
}

const MAX_BYTES = 50 * 1024 * 1024;

export default function BelgeYukleScreen() {
  const params = useLocalSearchParams<{ caseId?: string; caseTitle?: string }>();
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  const caseTitle = typeof params.caseTitle === "string" ? params.caseTitle : "";
  const router = useRouter();
  const online = useOnline();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadResult[]>([]);

  const addAsset = useCallback((asset: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number | null; name?: string; size?: number | null }, isImage: boolean) => {
    const name = asset.fileName ?? asset.name ?? `belge-${Date.now()}.${isImage ? "jpg" : "bin"}`;
    const size = asset.fileSize ?? asset.size ?? null;
    if (size !== null && size > MAX_BYTES) {
      setError(`${name}: 50 MB üst sınırını aşıyor.`);
      return;
    }
    setError(null);
    setPicked((prev) => [...prev, { uri: asset.uri, name, mimeType: asset.mimeType ?? (isImage ? "image/jpeg" : "application/octet-stream"), size, isImage }]);
  }, []);

  async function fromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Kamera izni verilmedi. Ayarlar'dan izin verebilirsiniz.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
    if (res.canceled) return;
    for (const a of res.assets) addAsset(a, true);
  }

  async function fromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Galeri izni verilmedi.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsMultipleSelection: true, selectionLimit: 10 });
    if (res.canceled) return;
    for (const a of res.assets) addAsset(a, true);
  }

  async function fromFiles() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ["application/pdf", "image/*", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"] });
    if (res.canceled) return;
    for (const a of res.assets) addAsset(a, (a.mimeType ?? "").startsWith("image/"));
  }

  async function upload() {
    if (!online) {
      setError("Bağlantı gerekli. Belgeler cihazda saklanmaz; sunucuya yüklenir.");
      return;
    }
    if (!caseId || picked.length === 0) return;
    setBusy(true);
    setError(null);
    const results: UploadResult[] = [];
    try {
      for (const [i, p] of picked.entries()) {
        setProgress(`${i + 1}/${picked.length} yükleniyor: ${p.name}`);
        results.push(await uploadDocument({ caseId, uri: p.uri, name: p.name, mimeType: p.mimeType, source: "MANUEL", folderPath: "/Mobil" }));
      }
      setDone(results);
      setPicked([]);
      setProgress(null);
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Belge yükle" }} />
      <ScrollScreen>
        <H2>{caseTitle || "Dosyaya belge yükle"}</H2>
        <Muted style={styles.note}>
          Kamera ile çekilen görüntü ve seçilen dosyalar dosyaya yüklenir; sunucu metni çıkarır (OCR), sınıflandırır ve
          süre/görev önerisi üretir. Öneriler onayınız olmadan işlem yapmaz.
        </Muted>

        <Section title="Kaynak seç">
          <View style={styles.row}>
            <Button title="Kamera" onPress={() => void fromCamera()} disabled={busy} />
            <Button title="Galeri" onPress={() => void fromGallery()} disabled={busy} variant="secondary" />
            <Button title="Dosya" onPress={() => void fromFiles()} disabled={busy} variant="secondary" />
          </View>
        </Section>

        {picked.length > 0 ? (
          <Section title={`Seçilenler (${picked.length})`}>
            {picked.map((p, i) => (
              <Card key={`${p.uri}-${i}`} onPress={() => setPicked((prev) => prev.filter((_, j) => j !== i))}>
                <View style={styles.pickedRow}>
                  {p.isImage ? <Image source={{ uri: p.uri }} style={styles.thumb} /> : null}
                  <View style={styles.pickedText}>
                    <Body numberOfLines={2}>{p.name}</Body>
                    <Muted>
                      {p.mimeType}
                      {p.size ? ` · ${(p.size / 1024).toFixed(0)} KB` : ""} · kaldırmak için dokunun
                    </Muted>
                  </View>
                </View>
              </Card>
            ))}
            <Button title={busy ? (progress ?? "Yükleniyor…") : `${picked.length} belgeyi yükle`} onPress={() => void upload()} disabled={busy || !online} />
          </Section>
        ) : null}

        {error ? <Body style={styles.error}>{error}</Body> : null}

        {done.length > 0 ? (
          <Section title="Yüklendi">
            {done.map((d) => (
              <Card key={d.id}>
                <Body>{d.name}</Body>
                <Muted>{d.duplicate ? "Bu belge zaten dosyada vardı (kopya yüklenmedi)." : `Belge hattı: ${d.pipelineStatus ?? "kuyrukta"} · OCR sunucuda`}</Muted>
              </Card>
            ))}
            <Button title="Dosyaya dön" onPress={() => router.back()} variant="secondary" />
          </Section>
        ) : null}
      </ScrollScreen>
    </>
  );
}

const styles = StyleSheet.create({
  note: { marginBottom: space.md },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  pickedRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  pickedText: { flex: 1 },
  error: { color: colors.danger, marginTop: space.sm },
});
