import base32Decode from "base32-decode";
import { Hono } from "hono";
import { getKV } from "./utils";

const app = new Hono();
// 存储默认密钥
const kv = getKV("totp-demo");

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});
/**
 * 生成 HMAC 签名
 * 
 * @param data - 要签名的数据
 * @param key - 用于签名的密钥
 * @param algorithm - 哈希算法，默认为 'SHA-1'
 * @returns HMAC 签名结果
 */
async function generateHMAC(data: Uint8Array, key: Uint8Array, algorithm = 'SHA-1'): Promise<Uint8Array> {
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
 * 使用 SHA-1 算法生成 HMAC 签名
 * 
 * @param key - 用于签名的密钥
 * @param data - 要签名的数据
 * @returns HMAC-SHA-256 签名结果
 */
async function hmacSha256(key: Uint8Array, data: Uint8Array) {
  return generateHMAC(data, key, 'SHA-256');
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

    // 4. 计算HMAC-SHA256
    const hmacArray = await hmacSha256(key, TBytes);

    // 5. 截断处理：取哈希值最后1字节的低4位作为偏移量，截取4字节
    const offset = hmacArray[hmacArray.length - 1] & 0x0F; // 0-15
    let truncated = 0;
    for (let i = 0; i < 4; i++) {
      truncated = (truncated << 8) | hmacArray[offset + i];
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
    
    if (!userInput || typeof userInput !== 'string') {
      throw new Error('Invalid OTP: must be a non-empty string');
    }
    
    const currentTime = Date.now();
    // 检查当前时间前后window个周期的TOTP
    for (let t = -window; t <= window; t++) {
      const T = Math.floor((currentTime + t * period * 1000) / (period * 1000));
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

    // 计算 HMAC-SHA256
    const hmacArray = await hmacSha256(key, TBytes);

    // 截断处理
    const offset = hmacArray[hmacArray.length - 1] & 0x0F;
    let truncated = 0;
    for (let i = 0; i < 4; i++) {
      truncated = (truncated << 8) | hmacArray[offset + i];
    }
    
    // 生成 OTP
    const otp = (truncated & 0x7FFFFFFF) % (10 ** digits);
    return otp.toString().padStart(digits, '0');
  } catch (error) {
    console.error('Error generating TOTP with specific T:', error);
    throw new Error('Failed to generate TOTP');
  }
}
app.post("/totp/verify", async (c) => {
  try {
    const {  otp } = await c.req.json();
    const secret = await kv; // 获取存储的密钥
    // 输入验证
    if (!secret || typeof secret !== 'string') {
      return c.json({ error: "Invalid secret" }, 400);
    }
    
    if (!otp || typeof otp !== 'string' || !/^\d+$/.test(otp)) {
      return c.json({ error: "Invalid OTP format" }, 400);
    }
    
    const isValid = await verifyTOTP(secret, otp);
    return c.json({ isValid });
  } catch (error) {
    return c.json({ error: "Invalid request format" }, 400);
  }
});
app.post("/totp/generate", async (c) => {
  try {
    const { secret } = await c.req.json();
    
    // 输入验证
    if (!secret || typeof secret !== 'string') {
      return c.json({ error: "Invalid secret" }, 400);
    }
    
    const otp = await generateTOTP(secret);
    return c.json({ otp });
  } catch (error) {
    return c.json({ error: "Invalid request format" }, 400);
  }
});
export default app;
