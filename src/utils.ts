import { env } from "cloudflare:workers"
import base32Decode from "base32-decode";

export const TOTP_ALGORITHM = 'HMAC-SHA-1';
/**
 * 从 Cloudflare KV 存储中获取指定键的值
 * @param key 要获取的键名，默认为 "default-key"
 * @param namespace KV 命名空间名称，默认为 "test"
 * @returns 返回存储的字符串值，如果不存在则返回 null
 * @throws 如果参数无效或操作超时，将抛出错误
 */
export async function getKV(key: string = "default-key"): Promise<string | null> {
    // 参数验证
    if (!key || typeof key !== 'string') {
        throw new Error('Invalid key: Key must be a non-empty string');
    }
    
    try {
        // 检查命名空间是否存在
        if (!env.test) {
            console.warn(`KV namespace "test" does not exist, using fallback secret`);
            // 返回一个默认的测试密钥，仅用于开发环境
            return "JBSWY3DPEHPK3PXP";
        }
        
        // 使用 Promise.race 添加超时处理
        const timeout = new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('KV operation timed out')), 5000);
        });
        
        try {
            // 正确使用 Cloudflare KV API 并添加超时处理
            const result = await Promise.race([
                env.test.get(key),
                timeout
            ]);
            
            // 根据 Cloudflare KV API 文档，get() 方法直接返回值或 null
            return typeof result === 'string' ? result : null;
        } catch (kvError) {
            if (kvError instanceof Error && kvError.message.includes('timed out')) {
                console.error(`KV operation timed out for key "${key}"`);
                throw kvError;
            }
            console.error(`Error accessing KV for key "${key}":`, kvError);
            return null;
        }
    } catch (error) {
        // 区分不同类型的错误
        if (error instanceof Error) {
            // 只记录非预期错误，避免日志污染
            if (!error.message.includes('timed out')) {
                console.error(`Error fetching key "${key}" from KV namespace "test":`, error.message);
            }
            
            // 对于关键错误，重新抛出以便调用者处理
            if (error.message.includes('timed out')) {
                throw error;
            }
        } else {
            console.error(`Unknown error fetching key "${key}" from KV namespace "test":`, error);
        }
        return null;
    }
}
/**
 * 生成 HMAC 签名
 * 
 * @param data - 要签名的数据
 * @param key - 用于签名的密钥
 * @param algorithm - 哈希算法，默认为 'SHA-256'
 * @returns HMAC 签名结果
 */
export async function generateHMAC(data: Uint8Array, key: Uint8Array, algorithm = 'SHA-256'): Promise<Uint8Array> {
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      data
    );
    return new Uint8Array(signature);
  } catch (error) {
    console.error('Error generating HMAC:', error);
    throw new Error(`Failed to generate HMAC with algorithm ${algorithm}`);
  }
}

/**
 * 使用 SHA-256 算法生成 HMAC 签名
 * 
 * @param key - 用于签名的密钥
 * @param data - 要签名的数据
 * @returns HMAC-SHA-256 签名结果
 */
export async function hmacSha1(key: Uint8Array, data: Uint8Array) {
  return generateHMAC(data, key, 'SHA-1');
}
/**
 * 生成基于时间的一次性密码 (TOTP)
 * 
 * @param secretBase32 - Base32 编码的密钥
 * @param period - TOTP 周期，默认 30 秒
 * @param digits - TOTP 位数，默认 6 位
 * @returns 生成的 TOTP 码
 * @throws 如果密钥无效或解码失败
 */
export async function generateTOTP(secretBase32: string, period = 30, digits = 6) {
  try {
    // 输入验证
    if (!secretBase32 || typeof secretBase32 !== 'string') {
      throw new Error('Invalid secret: must be a non-empty string');
    }

    if (typeof period !== 'number' || period <= 0) {
      throw new Error('Invalid period: must be a positive number');
    }

    if (typeof digits !== 'number' || digits <= 0 || !Number.isInteger(digits)) {
      throw new Error('Invalid digits: must be a positive integer');
    }

    // 1. 解码Base32密钥为字节数组
    const key = new Uint8Array(base32Decode(secretBase32, 'RFC4648'));

    // 2. 计算时间步长T（当前时间戳/周期，取整数）
    let T = Math.floor(Date.now() / (period * 1000));

    // 3. 将T转换为8字节大端整数（HMAC输入为64位整数）
    const TBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      TBytes[i] = T & 0xFF; // 低字节优先
      T = T >>> 8;
    }

    // 4. 计算HMAC-SHA1
    const hmacArray = await hmacSha1(key, TBytes);

    // 5. 截断处理：取哈希值最后1字节的低4位作为偏移量，截取4字节
    const offset = hmacArray[hmacArray.length - 1] & 0x0F; // 0-15
    let truncated = 0;
    // 确保不会越界访问
    if (offset + 3 < hmacArray.length) {
      for (let i = 0; i < 4; i++) {
        truncated = (truncated << 8) | hmacArray[offset + i];
      }
    } else {
      throw new Error('HMAC array too small for truncation');
    }

    // 6. 去符号位并模10^digits，确保6位密码
    const otp = (truncated & 0x7FFFFFFF) % (10 ** digits);
    return otp.toString().padStart(digits, '0'); // 补前导0
  } catch (error) {
    console.error('Error generating TOTP:', error);
    throw new Error('Failed to generate TOTP');
  }
}
/**
 * 验证用户输入的 TOTP 码是否有效
 * 
 * @param secretBase32 - Base32 编码的密钥
 * @param userInput - 用户输入的 TOTP 码
 * @param period - TOTP 周期，默认 30 秒
 * @param digits - TOTP 位数，默认 6 位
 * @param window - 验证窗口大小，默认为 1（检查前后各 1 个周期）
 * @returns 如果 TOTP 码有效则返回 true，否则返回 false
 */
export async function verifyTOTP(secretBase32: string, userInput: string, period = 30, digits = 6, window = 1) {
  try {
    // 输入验证
    if (!secretBase32 || typeof secretBase32 !== 'string') {
      throw new Error('Invalid secret: must be a non-empty string');
    }

    if (typeof period !== 'number' || period <= 0) {
      throw new Error('Invalid period: must be a positive number');
    }

    if (typeof digits !== 'number' || digits <= 0 || !Number.isInteger(digits)) {
      throw new Error('Invalid digits: must be a positive integer');
    }

    if (!userInput || typeof userInput !== 'string') {
      throw new Error('Invalid OTP: must be a non-empty string');
    }

    const currentTime = Date.now();
    // 检查当前时间前后window个周期的TOTP
    const currentT = Math.floor(currentTime / (period * 1000));
    for (let t = -window; t <= window; t++) {
      const T = currentT + t;  // 正确计算时间步长
      const totp = await generateTOTPWithT(secretBase32, T, period, digits);
      if (totp === userInput) return true;
    }
    return false;
  } catch (error) {
    console.error('Error verifying TOTP:', error);
    return false; // 验证失败时返回 false
  }
}
/**
 * 辅助函数：使用指定的时间步长 T 生成 TOTP（用于验证）
 * 
 * @param secretBase32 - Base32 编码的密钥
 * @param T - 时间步长值
 * @param period - TOTP 周期，默认 30 秒
 * @param digits - TOTP 位数，默认 6 位
 * @returns 生成的 TOTP 码
 */
export async function generateTOTPWithT(secretBase32: string, T: number, period = 30, digits = 6) {
  try {
    // 输入验证
    if (!secretBase32 || typeof secretBase32 !== 'string') {
      throw new Error('Invalid secret: must be a non-empty string');
    }

    if (typeof period !== 'number' || period <= 0) {
      throw new Error('Invalid period: must be a positive number');
    }

    if (typeof digits !== 'number' || digits <= 0 || !Number.isInteger(digits)) {
      throw new Error('Invalid digits: must be a positive integer');
    }

    if (typeof T !== 'number' || isNaN(T)) {
      throw new Error('Invalid time step T: must be a number');
    }

    // 解码 Base32 密钥
    const key = new Uint8Array(base32Decode(secretBase32, 'RFC4648'));

    // 将 T 转换为 8 字节大端整数
    const TBytes = new Uint8Array(8);
    let tempT = T; // 使用临时变量，避免修改原始参数
    for (let i = 7; i >= 0; i--) {
      TBytes[i] = tempT & 0xFF;
      tempT = tempT >>> 8;
    }

    // 计算 HMAC-SHA1
    const hmacArray = await hmacSha1(key, TBytes);

    // 截断处理
    const offset = hmacArray[hmacArray.length - 1] & 0x0F;
    let truncated = 0;
    // 确保不会越界访问
    if (offset + 3 < hmacArray.length) {
      for (let i = 0; i < 4; i++) {
        truncated = (truncated << 8) | hmacArray[offset + i];
      }
    } else {
      throw new Error('HMAC array too small for truncation');
    }

    // 生成 OTP
    const otp = (truncated & 0x7FFFFFFF) % (10 ** digits);
    return otp.toString().padStart(digits, '0');
  } catch (error) {
    console.error('Error generating TOTP with specific T:', error);
    throw new Error('Failed to generate TOTP');
  }
}
