import { env } from "cloudflare:workers"

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
            throw new Error(`KV namespace "test" does not exist`);
        }
        
        // 使用 Promise.race 添加超时处理
        const timeout = new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('KV operation timed out')), 5000);
        });
        
        // 正确使用 Cloudflare KV API 并添加超时处理
        const result = await Promise.race([
            env.test.get(key),
            timeout
        ]);
        
        // 根据 Cloudflare KV API 文档，get() 方法直接返回值或 null
        return typeof result === 'string' ? result : null;
    } catch (error) {
        // 区分不同类型的错误
        if (error instanceof Error) {
            // 只记录非预期错误，避免日志污染
            if (!error.message.includes('does not exist') && !error.message.includes('timed out')) {
                console.error(`Error fetching key "${key}" from KV namespace ": test`, error.message);
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