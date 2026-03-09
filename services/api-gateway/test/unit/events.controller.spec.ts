import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventsController } from '../../src/modules/events/events.controller';
import { EventsService } from '../../src/modules/events/events.service';
import { EventDto } from '../../src/modules/events/event.dto';
import { JETSTREAM } from '../../src/providers/nats.provider';
import { REDIS_CLIENT } from '../../src/providers/redis.provider';

describe('EventsController', () => {
  let controller: EventsController;
  let service: EventsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        EventsService,
        {
          provide: JETSTREAM,
          useValue: { publish: mock(() => Promise.resolve({ seq: 1 })) },
        },
        {
          provide: REDIS_CLIENT,
          useValue: {
            setex: mock(() => Promise.resolve('OK')),
            get: mock(() => Promise.resolve(null)),
          },
        },
      ],
    }).compile();

    controller = module.get(EventsController);
    service = module.get(EventsService);
  });

  describe('POST /events', () => {
    it('should return id and accepted status', async () => {
      const dto = new EventDto();
      dto.type = 'created';
      dto.payload = { name: 'test' };
      const result = await controller.publish(dto);

      expect(result).toHaveProperty('id');
      expect(result.status).toBe('accepted');
      expect(typeof result.id).toBe('string');
    });
  });

  describe('GET /results/:id', () => {
    it('should return result when found', async () => {
      const data = { eventId: 'abc', processed: true };
      service.getResult = mock(() => Promise.resolve(data)) as any;

      const result = await controller.getResult('abc');
      expect(result).toEqual(data);
    });

    it('should throw NotFoundException when result is null', async () => {
      service.getResult = mock(() => Promise.resolve(null)) as any;

      try {
        await controller.getResult('nonexistent');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
      }
    });
  });
});
