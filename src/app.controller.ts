import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Health check and engine status' })
  @ApiResponse({
    status: 200,
    description: 'Returns health status message',
    schema: {
      example: {
        success: true,
        data: 'Hello World!',
      },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
