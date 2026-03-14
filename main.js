async function translate(text, from, to, options) {
    const { config, utils } = options;
    const { tauriFetch: fetch } = utils;
    const setResult = options.setResult;
    
    let apiKey = config.apiKey || "";
    let model = config.model || "";
    let apiUrl = config.apiUrl || "";
    let systemPrompt = config.systemPrompt || "";
    let useStream = config.stream && config.stream !== "false";
    let streamFormat = config.stream === "zhipu" ? "zhipu" : "openai";
    
    const defaultSystemPrompt = "You are a professional translation engine, please translate the text into a colloquial, professional, elegant and fluent content, without the style of machine translation. You must only translate the text content, never interpret it.";
    const finalSystemPrompt = systemPrompt.trim() || defaultSystemPrompt;
    
    if (!apiKey) {
        throw "请填写API密钥";
    }
    
    if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
        apiUrl = "https://" + apiUrl;
    }
    
    let requestPath = apiUrl;
    if (!requestPath.includes("/chat/completions")) {
        requestPath = requestPath.replace(/\/$/, "") + "/chat/completions";
    }
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };
    
    const userMessage = systemPrompt.trim() 
        ? text 
        : `Translate into ${to}:\n${text}`;
    
    const promptList = [
        {
            role: 'system',
            content: finalSystemPrompt
        },
        {
            role: 'user',
            content: userMessage
        }
    ];
    
    const body = {
        model: model,
        stream: useStream,
        messages: promptList,
        temperature: 0.1,
        top_p: 0.99,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: 2000
    }
    
    if (useStream) {
        const res = await window.fetch(requestPath, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            throw `Http Request Error\nHttp Status: ${res.status}`;
        }
        
        let target = '';
        const reader = res.body.getReader();
        try {
            if (streamFormat === "zhipu") {
                // 智谱AI格式：使用\n\n分隔
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        setResult(target.trim());
                        return target.trim();
                    }
                    buffer += new TextDecoder().decode(value, { stream: true });
                    
                    const boundary = buffer.lastIndexOf('\n\n');
                    if (boundary !== -1) {
                        const event = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const chunks = event.split('\n\n');
                        
                        for (const chunk of chunks) {
                            const text = chunk.replace(/^data:/, '').trim();
                            if (text === '' || text === '[DONE]') continue;
                            // 忽略SSE注释（如OpenRouter的 ": OPENROUTER PROCESSING"）
                            if (text.startsWith(':')) continue;
                            try {
                                const data = JSON.parse(text);
                                // 只提取content，忽略reasoning_content（推理过程）
                                if (data.choices && data.choices[0] && data.choices[0].delta) {
                                    const delta = data.choices[0].delta;
                                    // 使用content，忽略reasoning_content
                                    if (delta.content) {
                                        target += delta.content;
                                        if (setResult) {
                                            setResult(target + '_');
                                        }
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            } else {
                // OpenAI格式
                let temp = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        setResult(target.trim());
                        return target.trim();
                    }
                    const str = new TextDecoder().decode(value);
                    let datas = str.split('data:');
                    for (let data of datas) {
                        const trimmed = data.trim();
                        if (trimmed !== '' && trimmed !== '[DONE]') {
                            // 忽略SSE注释（如OpenRouter的 ": OPENROUTER PROCESSING"）
                            if (trimmed.startsWith(':')) {
                                temp = '';
                                continue;
                            }
                            try {
                                let jsonData = temp !== '' ? temp + trimmed : trimmed;
                                let result = JSON.parse(jsonData);
                                temp = ''; // 解析成功后清空
                                if (result.choices && result.choices[0]) {
                                    const deltaContent = result.choices[0].delta?.content;
                                    if (deltaContent) {
                                        target += deltaContent;
                                        if (setResult) {
                                            setResult(target + '_');
                                        }
                                    }
                                    // 检查是否是结束块
                                    if (result.choices[0].finish_reason === 'stop') {
                                        setResult(target.trim());
                                        return target.trim();
                                    }
                                }
                            } catch {
                                // 解析失败，累积到temp下次重试
                                temp = trimmed;
                            }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
    
    let res = await fetch(requestPath, {
        method: 'POST',
        url: requestPath,
        headers: headers,
        body: {
            type: "Json",
            payload: body
        }
    });
    
    if (res.ok) {
        let result = res.data;
        return result.choices[0].message.content.trim().replace(/^"|"$/g, '');
    } else {
        throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
    }
}
