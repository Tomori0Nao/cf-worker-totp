import { Hono } from "hono";
import { generateTOTP, getKV, TOTP_ALGORITHM, verifyTOTP } from "./utils";
import { encodeQR } from 'qr';
import { secureHeaders } from "hono/secure-headers";

// 定义 CloudflareBindings 类型
interface CloudflareBindings {
  test: KVNamespace;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();
// 存储默认密钥
// let kv: Promise<string | null> = getKV("totp-demo");

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});
app.post("/totp/verify", async (c) => {
  try {
    console.info("json is ", await c.req.json())
    // const data = await c.req.json();
    // let opt = data["opt"];
    const { opt } = await c.req.json(); // 从请求体中获取 opt 参数
    let kv: Promise<string | null> = getKV("totp-demo");
    const secret = await kv; // 获取存储的密钥
    // 输入验证
    if (!secret || typeof secret !== 'string') {
      return c.json({ error: "Secret not configured" }, 500);
    }
    console.info("opt is ", opt)
    if (!opt || typeof opt !== 'string' || !/^\d{6}$/.test(opt)) {
      return c.json({ error: "Invalid OTP format: must be a 6-digit number" }, 400);
    }

    const isValid = await verifyTOTP(secret, opt);
    return c.json({ isValid });
  } catch (error) {
    console.error('Error verifying TOTP:', error);
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON format" }, 400);
    }
    return c.json({ error: "Server error" }, 500);
  }
});
app.post("/totp/generate", async (c) => {
  try {
    let kv: Promise<string | null> = getKV("totp-demo");
    const secret = await kv; // 获取存储的密钥

    // 输入验证
    if (!secret || typeof secret !== 'string') {
      return c.json({ error: "Invalid secret" }, 400);
    }

    try {
      const otp = await generateTOTP(secret);
      return c.json({ otp });
    } catch (genError) {
      console.error('Error generating TOTP:', genError);
      return c.json({ error: "Failed to generate TOTP" }, 500);
    }
  } catch (error) {
    console.error('Error parsing request:', error);
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON format" }, 400);
    }
    return c.json({ error: "Server error" }, 500);
  }
});
// generate QR code base on secret
app.post("/totp/showQRCode", async (c) => {
  try {
    let kv: Promise<string | null> = getKV("totp-demo");
    const secret = await kv;
    // check secret
    if (!secret || typeof secret !== 'string') {
      return c.json({ error: "Invalid secret" }, 400);
    }

    // 创建标准 TOTP URI 格式: otpauth://totp/Label:Account?secret=SECRET&issuer=Issuer
    // 对参数进行编码，防止 URI 注入
    // const encodedSecret = encodeURIComponent(secret);
    const totpUri = `otpauth://totp/CF-Worker-TOTP:User?secret=${secret}&issuer=CF-Worker-TOTP&digits=6&period=30&algorithm=${TOTP_ALGORITHM}`;
    //  use qr.js to generate qr code
    const svgElement = encodeQR(totpUri, "svg");


    c.header('Content-Type', 'image/svg+xml');
    return c.body(svgElement)
  }
  catch (error) {
    console.error('Error generating QR code:', error);
    return c.json({ error: "Failed to generate QR code" }, 500);
  }
});
export default app;
