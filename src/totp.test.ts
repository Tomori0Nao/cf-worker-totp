import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTOTP, verifyTOTP } from './index';

describe('TOTP Functions', () => {
  // 保存原始的 Date.now 方法
  const originalDateNow = Date.now;
  
  // 在每个测试前重置 mock
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  // 在每个测试后恢复原始方法
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateTOTP', () => {
    it('应该生成6位数的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP'; // 测试密钥
      const result = await generateTOTP(secret);
      expect(result).toMatch(/^\d{6}$/);
    });

    it('应该在不同时间生成不同的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置第一个时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      const code1 = await generateTOTP(secret);
      
      // 设置第二个时间点 (30秒后，新的时间周期)
      vi.setSystemTime(new Date('2023-01-01T00:00:30Z'));
      const code2 = await generateTOTP(secret);
      
      expect(code1).not.toBe(code2);
    });

    it('应该在同一时间周期内生成相同的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      const code1 = await generateTOTP(secret);
      
      // 同一周期内的另一时间点 (29秒后，仍在同一周期)
      vi.setSystemTime(new Date('2023-01-01T00:00:29Z'));
      const code2 = await generateTOTP(secret);
      
      expect(code1).toBe(code2);
    });

    it('应该根据指定的位数生成TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      const code4 = await generateTOTP(secret, 30, 4);
      const code8 = await generateTOTP(secret, 30, 8);
      
      expect(code4).toMatch(/^\d{4}$/);
      expect(code8).toMatch(/^\d{8}$/);
    });

    it('应该根据指定的周期生成TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      
      // 默认周期 (30秒)
      const code1 = await generateTOTP(secret);
      
      // 自定义周期 (60秒)
      const code2 = await generateTOTP(secret, 60);
      
      // 在30秒后，默认周期的码应该变化，但60秒周期的不变
      vi.setSystemTime(new Date('2023-01-01T00:00:30Z'));
      const code1After30s = await generateTOTP(secret);
      const code2After30s = await generateTOTP(secret, 60);
      
      expect(code1).not.toBe(code1After30s);
      expect(code2).toBe(code2After30s);
    });
  });

  describe('verifyTOTP', () => {
    it('应该验证正确的当前TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      
      // 生成当前的TOTP码
      const currentCode = await generateTOTP(secret);
      
      // 验证
      const isValid = await verifyTOTP(secret, currentCode);
      expect(isValid).toBe(true);
    });

    it('应该拒绝错误的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      
      // 错误的TOTP码
      const wrongCode = '000000';
      
      // 验证
      const isValid = await verifyTOTP(secret, wrongCode);
      expect(isValid).toBe(false);
    });

    it('应该验证前一个时间窗口的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置第一个时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      const previousCode = await generateTOTP(secret);
      
      // 前进到下一个时间窗口
      vi.setSystemTime(new Date('2023-01-01T00:00:30Z'));
      
      // 验证前一个窗口的码 (默认窗口大小为1)
      const isValid = await verifyTOTP(secret, previousCode);
      expect(isValid).toBe(true);
    });

    it('应该验证后一个时间窗口的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      
      // 获取下一个窗口的码
      vi.setSystemTime(new Date('2023-01-01T00:00:30Z'));
      const nextCode = await generateTOTP(secret);
      
      // 回到当前窗口
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      
      // 验证下一个窗口的码
      const isValid = await verifyTOTP(secret, nextCode);
      expect(isValid).toBe(true);
    });

    it('应该拒绝超出时间窗口的TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置第一个时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      const oldCode = await generateTOTP(secret);
      
      // 前进两个时间窗口 (超出默认窗口大小1)
      vi.setSystemTime(new Date('2023-01-01T00:01:00Z'));
      
      // 验证旧码
      const isValid = await verifyTOTP(secret, oldCode);
      expect(isValid).toBe(false);
    });

    it('应该根据指定的窗口大小验证TOTP码', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      
      // 设置第一个时间点
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
      const oldCode = await generateTOTP(secret);
      
      // 前进两个时间窗口
      vi.setSystemTime(new Date('2023-01-01T00:01:00Z'));
      
      // 使用默认窗口大小1验证 (应该失败)
      const isValidDefault = await verifyTOTP(secret, oldCode);
      
      // 使用窗口大小2验证 (应该成功)
      const isValidLargerWindow = await verifyTOTP(secret, oldCode, 30, 6, 2);
      
      expect(isValidDefault).toBe(false);
      expect(isValidLargerWindow).toBe(true);
    });
  });
});