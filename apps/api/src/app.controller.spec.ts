import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      // O health não toca no banco; /me tem teste e2e.
      providers: [{ provide: PrismaService, useValue: {} }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('health returns ok', () => {
    expect(appController.health()).toEqual({ status: 'ok' });
  });
});
