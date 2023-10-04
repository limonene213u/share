//next_chat_main.js

//大規模なリファクタリング実施後です。

import axios from 'axios';

import { formatForOpenAI, removeHistoryPrefixFromEntry} from '/server_logic/mainUIcommon.js'; //OK
import { generateSystemPrompt } from '/server_logic/systemPromptData.js'; //OK
import { fetchUserDataFromDB, getUserData } from '/server_logic/manage_user_info.js';
import { getChatbotInfo} from '/server_logic/get_chatbot_info.js'; //OK
import { fetchLatestChatHistory } from '/server_logic/context.js'; //OK
import { functions } from '/server_logic/functions_js/function_list.js'; //OK
import { processFunctionCall } from '/server_logic/functions_js/function_call.js'
import { createDBConnection } from '/server_logic/sql/sqlConnect.js'; 
import { fetchGcalPrompt } from '/server_logic/sql/getCalenderEvent.js';
import { getOAI } from '/server_logic/sql/getOpenAIInfo.js'; //OK

// configDataは非同期で取得するので、関数内で定義する方がいい
// let configData; // この行を削除
let chatbotInfo = {};
//let chatbotSayingExample = [];
const OPENAI_API_URL = `https://api.openai.com/v1/chat/completions`;

//sendMessage関数からリネーム
// inOutManager関数
export async function inOutManager(userMessage) {
  console.log("inOutManager関数が呼び出されました");
    if (!userMessage) return;
    try {
      const botResponse = await flowManager(userMessage);
      const savedResponse = await generateAndSaveBotResponse(botResponse, userMessage);
      return savedResponse;
    } catch (error) {
      handleError(error);
    }
  }

// flowManager関数
async function flowManager(promptText) {
  console.log("flowManager関数が呼び出されました");
  const configData = await loadConfig(); 

  const currentUserId = 1;
  let condition = 'default'; // デフォルトのconditionを設定
  
    // 初回のOpenAIへのリクエスト
    const initialResponse = await prepareSendFirstRequestToOpenAI(promptText, configData);
    console.log("【重要！！！】initialResponse:", initialResponse);
    console.log("【重要！！！】configData in flowManager:", configData);
  
  // initialResponseが取得できた後の処理をここに書く
    let functionResult = null;
    let functionCallingName = null;
    if (initialResponse && initialResponse.choices && initialResponse.choices[0]) {
      if (initialResponse.choices[0].message.function_call) {
        const functionCallResult = await processFunctionCall(initialResponse);
        functionResult = functionCallResult.result;
        functionCallingName = functionCallResult.functionName;
      }
    } else {
      console.error('initialResponse is not ready yet!');
    }

    // 非同期処理を一箇所にまとめる
    const [userDataArray, chatHistory] = await Promise.all([
      fetchUserDataFromDB(currentUserId),
      fetchLatestChatHistory()
    ]);

    // userDataの処理
    const userData = await getUserData(1);
    userDataArray.forEach(item => {
      userData[item.info_genre] = item.parameter;
    });
  
    // formattedHistoryの処理
    const formattedHistory = formatForOpenAI(chatHistory).map(removeHistoryPrefixFromEntry);
    const chatbotInfo = await getChatbotInfo();
  
    // dynamicSystemPromptの初期化
    let dynamicSystemPrompt = generateSystemPrompt(condition, chatbotInfo, userData);
  
    // 最終的なOpenAIへのリクエスト
    const finalResponse = await sendFinallyRequestToOpenAI(promptText, formattedHistory, dynamicSystemPrompt, userData, functionResult, functionCallingName, configData);
  
    return finalResponse;
  }
  

  async function prepareSendFirstRequestToOpenAI(promptText, configData) {
    console.log("sendFirstRequestToOpenAI関数が呼び出されました");
    console.log("【重要！！！】configData in prepareSendFirstRequestToOpenAI:", configData);
    // 1. MariaDBから関連データとconfigDataを同時に取得
    const [gcalsimplifiedData] = await Promise.all([
      fetchGcalPrompt (),
    ]);
    // 2. OpenAIへのリクエストデータを準備
    const preSendData = prepareRequestForOpenAI(promptText, gcalsimplifiedData, configData);
    // 3. OpenAIへリクエストを送信
    const firstResponse = await sendFirstRequestToOpenAI(preSendData, configData);
    return firstResponse;
  }

  //senfFinallyRequestToOpenAI関数を分割（全体処理）
// 元の関数を分割後の小関数で置き換えた
async function sendFinallyRequestToOpenAI(promptText, formattedHistory, dynamicSystemPrompt, userData, functionResult = null, functionCallingName = null) {
  console.log("sendFinallyRequestToOpenAI関数が呼び出されました");
  const configData = await loadConfig();
  console.log("configData in sendFinallyRequestToOpenAI:", configData);  // この行を追加
    const headers = createHeaders(configData);
    let messages = await createMessages(formattedHistory, dynamicSystemPrompt, userData, promptText);
    messages = await addFunctionResultToMessages(messages, functionResult, functionCallingName);
    const data = {
        model: configData[0]['model'],
        messages: messages
    };
    return await sendRequestToOpenAI(data, headers);
}

//以下は個別処理

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

//senfFinallyRequestToOpenAI関数から分割その１
// ヘッダーを作成する関数
async function createHeaders() {
  const configData = await loadConfig(); 
  if (!configData || !Array.isArray(configData) || configData.length === 0) {
    console.error('configData is not available');
    return null;  // ここでnullを返すにゃ
  }
  // configDataが正常な場合の処理
  return {
    'Authorization': `Bearer ${configData[0]['api-key']}`,
    'Content-Type': 'application/json',
  };
}

/*
//pullOutKeyword関数を分割その１
//ただし、１回目のリクエストでのキーワード検索は廃止（FunctionCallingの有無確認のみ）
async function gcalsimplifiedData(promptText) {
  console.log("localFetchGcalPrompt関数が呼び出されました");
  const gcalsimplifiedData = await importedFetchGcalPrompt();
  const gcalsimplifiedDataStr = JSON.stringify(gcalsimplifiedData);
  // 他にもMariaDBから取得するデータがあればここに追加
  return gcalsimplifiedDataStr;
}
*/

//pullOutKeyword関数を分割その２
//ただし、１回目のリクエストでのキーワード検索は廃止（FunctionCallingの有無確認のみ）
function prepareRequestForOpenAI(promptText, gcalsimplifiedData, configData) {
  console.log("prepareRequestForOpenAI関数が呼び出されました");

  // ここでgcalsimplifiedDataを文字列に変換するにゃ
  const gcalString = gcalsimplifiedData.map(event => `${event.summary} from ${event.start} to ${event.end} at ${event.location}`).join(', ');

  const { dateString, timeString } = getCurrentDateTime(); // ここでgetCurrentDateTimeを呼び出すにゃ
  const preSendData = {
    model: configData[0]['model'],
    messages: [
      {
        role: "system",
        content: `あなたはこれからChatBOTとしてロールプレイングをします。このシステムにはFunctionCallingの機能があります。Chatbotが会話に必要な情報を検索することができます。たとえば、過去の会話を参照する必要がある場合はrecall_memory_from_maria関数呼び出しによる参照情報の提供ができます。また、現在の日付と時刻を意識した回答をお願いします。日付：${dateString}, 時刻：${timeString}, ユーザーの直近の予定：${gcalString}`
      },
      { role: "user", content: promptText }
    ],
    functions: functions,
    function_call: "auto"
  };
  return preSendData; // ここでpreSendDataを返すにゃ
}

//pullOutKeyword関数を分割その３
//ただし、１回目のリクエストでのキーワード検索は廃止（FunctionCallingの有無確認のみ）
async function sendFirstRequestToOpenAI(preSendData) {
  const configData = await loadConfig();
  console.log("sendRequestToOpenAI関数が呼び出されました");
  console.log("configData in sendFirstRequestToOpenAI:", configData); 
    const firstResponse = await axios.post(OPENAI_API_URL, preSendData, {
        headers: {
        'Authorization': `Bearer ${configData[0]['api-key']}`,
        'Content-Type': 'application/json'
        }
    });
    return firstResponse;
}

//senfFinallyRequestToOpenAI関数から分割その２
// メッセージ配列を作成する関数
async function createMessages(formattedHistory, dynamicSystemPrompt, userData, promptText) {
  console.log("createMessages関数が呼び出されました");
    let resolvedDynamicSystemPrompt = await dynamicSystemPrompt;
    return [...formattedHistory, {role: "system", content: resolvedDynamicSystemPrompt}, {role: "user", content: `${userData["Userの通称"]} says: ${promptText}`}];
    }

//senfFinallyRequestToOpenAI関数から分割その３    
// FunctionCallingの結果をメッセージに追加する関数
async function addFunctionResultToMessages(messages, functionResult, functionCallingName) {
  console.log("addFunctionResultToMessages関数が呼び出されました");
    if (functionResult && functionCallingName) {
        const formatFunctionModule = await import(`/server_logic/functions_js/${functionCallingName}.js`);
        const formattedFunctionResult = formatFunctionModule.default(functionResult);        
        messages.push(formattedFunctionResult);
    }
    return messages;
}

//senfFinallyRequestToOpenAI関数から分割その４
// OpenAIにリクエストを送る関数
async function sendRequestToOpenAI(data, headers) {
  console.log("sendRequestToOpenAI関数が呼び出されました");
    try {
        return await axios.post(OPENAI_API_URL, data, { headers: headers });
    } catch (error) {
        console.error("Error from OpenAI API:", error.response.data);
        throw error;
    }
}

export async function saveChatHistory(userMessage, botResponse) {
  console.log("saveChatHistory関数が呼び出されました");
  const conn = createDBConnection();
  conn.connect();

  try {
    await new Promise((resolve, reject) => {
      const query = `INSERT INTO ${process.env.CONTEXT_DB_TABLE} (user_side, openai_side) VALUES (?, ?)`;
      conn.query(query, [userMessage, botResponse], (error) => {
        if (error) {
          reject('Error saving chat history');
          return;
        }
        resolve('Data saved successfully');
      });
    });
    console.log('Chat history saved successfully');
  } catch (error) {
    console.error('Error saving chat history:', error);
  } finally {
    conn.end();
  }
}

async function generateAndSaveBotResponse(response, promptText) {
    console.log("generateAndSaveBotResponse関数が呼び出されました");
    const botResponse = response.data.choices[0].message.content.trim();
    await saveChatHistory(promptText, botResponse);
    return botResponse;
  }

//エラー処理
function handleError(error) {
  if (error.response) {
    console.error("Error:", error.response.data);
  } else {
    console.error("Error:", error);
  }
  throw error;
}

  
  function getCurrentDateTime() {
    const now = new Date();
    return {
      dateString: now.toLocaleDateString(),
      timeString: now.toLocaleTimeString(),
    };
  }
    