import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";

/** @Global: kanal sağlayıcısı, dağıtım işi, parola sıfırlama ve demo talebi aynı SMTP'yi kullanır. */
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
