//main-functions.js

const configData = await loadConfig(); // ここでデータを取得にゃ
//let chatbotInfo = {};

import { formatForOpenAI, removeHistoryPrefixFromEntry} from '/server_logic/mainUIcommon.js'; //OK
import { generateSystemPrompt } from '/server_logic/systemPromptData.js'; //OK
import { fetchUserDataFromDB, getUserData } from '/server_logic/manage_user_info.js';
import { getChatbotInfo} from '/server_logic/get_chatbot_info.js'; //OK
import { fetchLatestChatHistory } from '/server_logic/context.js'; //OK
import { functions } from '/server_logic/functions_js/function_list.js'; //OK
import { processFunctionCall } from '/server_logic/functions_js/function_call.js'
import { fetchGcalPrompt} from '/server_logic/sql/getCalenderEvent.js';
import { getOAI } from '/server_logic/sql/getOpenAIInfo.js'; //OK

const OPENAI_API_URL = `https://api.openai.com/v1/chat/completions`;

const chatbotInfo = await getChatbotInfo();

// inOutManager関数
export async function inOutManager(userMessage) {
    console.log("inOutManager関数が呼び出されました");
      if (!userMessage) return;
      try {
        const botResponse = await flowManager(userMessage);
        const savedResponse = await generateAndSaveBotResponse(botResponse, userMessage);
        return savedResponse;
      } catch (error) {
        console.log("inOutManager関数でエラーが発生しました");
      }
    }

async function loadConfig() {
    console.log("loadConfig関数が呼び出されました");
    try {
      const configData = await getOAI(); // ここでデータを取得にゃ
      console.log(configData);
      console.log("API Key:", configData[0]['api-key']);
      console.log("GPT_Model:", configData[0]['model']);
      return configData;  // ここでデータを返すにゃ
    } catch (error) {
      console.error('設定ファイルの読み込みエラー:', error);
    }
  }  


async function pullOutKeyword(promptText, functions) {
    console.log("pullOutKeyword関数が呼び出されました");
    const now = new Date();
    const dateString = now.toLocaleDateString(); // "YYYY/MM/DD" 形式
    const timeString = now.toLocaleTimeString(); // "HH:MM:SS" 形式
    console.log(dateString);
    console.log(timeString);

    const gcalsimplifiedData = await fetchGcalPrompt();
    console.log("Googleカレンダーで実際にChatBotに渡されるデータ；", gcalsimplifiedData);
    const configData = await loadConfig(); // ここでデータを取得にゃ

    const data = {
        model: configData[0]['model'],
        messages: [
            {
                role: "system",
                content: "あなたはこれからChatBOTとしてロールプレイングをします。このシステムにはFunctionCallingの機能がありますので、Chatbotが能動的に関数を使い、会話に必要な情報を検索することができます。たとえば、過去の会話を参照する必要がある場合はrecall_memory_from_maria関数呼び出しによる参照情報の提供ができます。また、現在の日付と時刻を意識した回答をお願いします。日付：${dateString}, 時刻：${timeString}, ユーザーの直近の予定：${gcalsimplifiedData}"
            },
            { role: "user", content: promptText }
        ],
        functions: functions,
        function_call: "auto"
    };

    console.log("最初のリクエスト：", data);

    console.log("OpenAIにリクエストを送信する際のconfigData", configData);


    const response = await axios.post(OPENAI_API_URL, data, {
        headers: {
            'Authorization': `Bearer ${configData[0]['api-key']}`,
            'Content-Type': 'application/json'
        }
    });

    console.log("OpenAI APIからの最初の回答：", response.data);
    return response.data;
}

async function sendFinallyRequestToOpenAI(promptText, formattedHistory, dynamicSystemPrompt, userData, functionResult = null, functionCallingName = null) {
    console.log("sendFinallyRequestToOpenAI関数が呼び出されました");
    console.log("formattedHistory:", formattedHistory);
    console.log("dynamicSystemPrompt:", dynamicSystemPrompt);
    console.log("sendFinallyRequestToOpenAIでのuserData:", userData);
    console.log('sendFinallyRequestToOpenAIで${userData["Userの通称"]} とすると：', userData["Userの通称"] )


    const headers = {
        'Authorization': `Bearer ${configData[0]['api-key']}`,
        'Content-Type': 'application/json',
    };

    let resolvedDynamicSystemPrompt = await dynamicSystemPrompt;
    let messages = [...formattedHistory, {role: "system", content: resolvedDynamicSystemPrompt}, {role: "user", content: `${userData["Userの通称"]} says: ${promptText}`}];

    //let messages = [...formattedHistory, {role: "system", content: dynamicSystemPrompt}, {role: "user", content: `${userData["Userの通称"]} says: ${promptText}`}];
    console.log("messagesの内容：", messages);

    // FunctionCallingの結果をmessagesに追加する
    if (functionResult && functionCallingName) {
        console.log("functionCallingNameはこれ：",functionCallingName);
        const formatFunctionModule = await import(`/server_logic/functions_js/${functionCallingName}.js`);
        const formattedFunctionResult = formatFunctionModule.default(functionResult);        
        messages.push(formattedFunctionResult);
    }


    const configData = await loadConfig(); // ここでデータを取得にゃ
    const data = {
        model: configData[0]['model'],
        messages: messages
    };

    console.log("Sending data to OpenAI:", data);
    console.log("Headers for OpenAI request:", headers);
    try {
        return await axios.post(OPENAI_API_URL, data, { headers: headers });
    } catch (error) {
        console.error("Error from OpenAI API:", error.response.data);
        throw error;
    }    
}

async function flowManager() {
    console.log("sendMessage関数が呼び出されました");
    const userMessage = messageInput.value;
    if (!userMessage) return;

    displayUserMessage(userMessage);
    messageInput.value = '';

    const initialResponse = await getResponse(userMessage);
    const botResponse = await generateAndSaveBotResponse(initialResponse, userMessage);

    await doPlayVoice(botResponse);
    await displayBotResponse(botResponse);
}

async function generateAndSaveBotResponse(response, promptText) {
    console.log("generateAndSaveBotResponse関数が呼び出されました");
    const botResponse = response.data.choices[0].message.content.trim();
    await saveChatHistory(promptText, botResponse);
    return botResponse;
    }

async function getResponse(promptText) {
    console.log("getResponse関数が呼び出されました");
    let functionResult = null;
    let functionCallingName = null;

    const initialResponse = await pullOutKeyword(promptText, functions);

    const currentUserId = 1;
    const userDataArray = await fetchUserDataFromDB(currentUserId);
    const userData = await getUserData(1);
    console.log("getResponseのuserData", userData)
    userDataArray.forEach(item => {
        userData[item.info_genre] = item.parameter;
    });

    const chatHistory = await fetchLatestChatHistory();
    const formattedHistory = formatForOpenAI(chatHistory).map(removeHistoryPrefixFromEntry); // ここで初めてformattedHistoryを定義

    let condition = 'default'; // デフォルトのconditionを設定

    // ここでdynamicSystemPromptを初期化
    let dynamicSystemPrompt = generateSystemPrompt(condition, chatbotInfo, userData);
    console.log("getResponseのなかのuserDataその2:", userData);

    // FunctionCallingが要求されているか否かを判断
    if (initialResponse.choices[0].message.function_call) {  
        const functionCallResult = await processFunctionCall(initialResponse);
        const functionResult = functionCallResult.result;
        const functionCallingName = functionCallResult.functionName;

        // Use the function result as a new prompt and query OpenAI again
        return await sendFinallyRequestToOpenAI(promptText, formattedHistory, dynamicSystemPrompt, userData, functionResult, functionCallingName);
    }

    // 最終的なOpenAIへのリクエスト
    console.log("最終的なOpenAIへのリクエストで渡されるチャット内容", promptText);
    return await sendFinallyRequestToOpenAI(promptText, formattedHistory, dynamicSystemPrompt, userData, functionResult, functionCallingName);
}