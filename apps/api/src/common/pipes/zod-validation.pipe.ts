import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/** Zod şemasıyla gövde doğrulaması: @Body(new ZodValidationPipe(schema)) */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Gönderilen veri doğrulanamadı.",
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
