import React from "react";
import { Stack, useRouter } from "expo-router";
import { Button, EmptyState, Screen } from "@/ui/components";
import { space } from "@/ui/theme";

/** Tanımsız derin bağlantı (ör. eski bir bildirim adresi) buraya düşer. */
export default function NotFoundScreen(): React.JSX.Element {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: "Sayfa bulunamadı" }} />
      <Screen style={{ justifyContent: "center", padding: space.xl }}>
        <EmptyState
          title="Bu adres bulunamadı."
          hint="Bağlantı eski olabilir. Bugün ekranından devam edebilirsiniz."
        />
        <Button title="Bugün ekranına dön" onPress={() => router.replace("/")} style={{ marginTop: space.lg }} />
      </Screen>
    </>
  );
}
