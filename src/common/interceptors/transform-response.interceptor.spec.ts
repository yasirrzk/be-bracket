import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { TransformResponseInterceptor } from './transform-response.interceptor';

describe('TransformResponseInterceptor', () => {
  let interceptor: TransformResponseInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new TransformResponseInterceptor();
  });

  it('should wrap raw response with success: true and data property', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockCallHandler: CallHandler = {
      handle: () => of({ foo: 'bar' }),
    };

    interceptor.intercept(mockContext, mockCallHandler).subscribe({
      next: (result) => {
        expect(result).toEqual({
          success: true,
          data: { foo: 'bar' },
        });
        done();
      },
      error: (err) => done.fail(err),
    });
  });

  it('should preserve already formatted responses', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockCallHandler: CallHandler = {
      handle: () => of({ success: true, data: [1, 2, 3] }),
    };

    interceptor.intercept(mockContext, mockCallHandler).subscribe({
      next: (result) => {
        expect(result).toEqual({
          success: true,
          data: [1, 2, 3],
        });
        done();
      },
      error: (err) => done.fail(err),
    });
  });
});
