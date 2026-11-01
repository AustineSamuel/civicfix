import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

@Catch()
export class CivicFixExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();

    if (error instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: "Bad Request",
        message: "Request validation failed.",
        details: error.issues.map(({ path, message }) => ({ path, message }))
      });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: "Conflict",
        message: "A record with the supplied unique value already exists."
      });
      return;
    }

    if (typeof error === "object" && error !== null &&
      "code" in error && error.code === "LIMIT_FILE_SIZE") {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: "Payload Too Large",
        message: "Evidence exceeds the configured file-size limit."
      });
      return;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const result = error.getResponse();
      const message = typeof result === "string"
        ? result
        : typeof result === "object" && result !== null && "message" in result
          ? result.message
          : "The request could not be completed.";
      response.status(status).json({
        statusCode: status,
        error: HttpStatus[status] ?? "Error",
        message
      });
      return;
    }

    console.error("Unhandled CivicFix API error", error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: "Internal Server Error",
      message: "An unexpected error occurred."
    });
  }
}
