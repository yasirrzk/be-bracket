import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseFormat<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ResponseFormat<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    return next.handle().pipe(
      map((data: unknown) => {
        // If data is already formatted or has meta, preserve structure
        if (
          data !== null &&
          typeof data === 'object' &&
          'success' in data &&
          'data' in data
        ) {
          return data as ResponseFormat<T>;
        }
        return {
          success: true,
          data: (data ?? null) as T,
        };
      }),
    );
  }
}
