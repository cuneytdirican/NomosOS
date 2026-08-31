/**
 * /dosyalar — dosya arama.
 *
 * Sunucu `q` süzgecini esas no, başlık, müvekkil ve taraf üzerinde çalıştırır
 * ve serbest metni 100 karakterle sınırlar. İstemci, her tuş vuruşunda istek
 * atmamak için 400 ms bekletir (adliye şebekesinde her istek pahalıdır).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { errorMessage } from "@/api/client";
import { searchCases } from "@/api/endpoints";
import type { CaseBrief } from "@/api/types";
import { DesktopOnlyNote, EmptyState, ErrorState, Loading, Muted, ScrollScreen } from "@/ui/components";
import { CaseRow } from "@/ui/list-items";
import { colors, font, radius, space, TOUCH } from "@/ui/theme";

const SEARCH_DEBOUNCE_MS = 400;

export default function CasesScreen(): React.JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CaseBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gecikmeli arama: yalnız son tuş vuruşu istek doğurur.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Yavaş dönen eski bir yanıt, yeni aramanın sonucunu ezmesin.
  const requestId = useRef(0);

  const run = useCallback(async (term: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await searchCases(term);
      if (id === requestId.current) setItems(result);
    } catch (caught) {
      if (id === requestId.current) setError(errorMessage(caught));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(query), SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, run]);

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Esas no, müvekkil veya taraf ara…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          maxLength={100}
        />
      </View>

      <ScrollScreen>
        {loading && items.length === 0 ? (
          <Loading label="Dosyalar aranıyor…" />
        ) : error !== null ? (
          <ErrorState message={error} onRetry={() => void run(query)} />
        ) : items.length === 0 ? (
          <EmptyState
            title={query.trim().length > 0 ? "Eşleşen dosya bulunamadı." : "Dosya bulunamadı."}
            hint="Esas numarasının bir bölümünü ya da müvekkil adını yazmayı deneyin."
          />
        ) : (
          <>
            <Muted style={styles.count}>{items.length} dosya listeleniyor.</Muted>
            {items.map((item) => (
              <CaseRow
                key={item.id}
                item={{
                  id: item.id,
                  title: item.title,
                  fileNumber: item.fileNumber ?? null,
                  courtName: item.courtName ?? null,
                  status: item.status,
                  clientName: item.client?.name ?? null,
                }}
                onPress={() => router.push(`/dosya/${item.id}`)}
              />
            ))}
          </>
        )}

        <DesktopOnlyNote what="Yeni dosya ve müvekkil açma, dosya bilgisi düzenleme" />
      </ScrollScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    backgroundColor: colors.navy,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  input: {
    minHeight: TOUCH.min,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.body,
    color: colors.text,
  },
  count: { marginBottom: space.md },
});
