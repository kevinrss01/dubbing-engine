import OpenAI from 'openai';
import { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources';

export type OpenAIModel = string;

export const models = {
  gpt4o: 'gpt-4o',
  chatgpt4oLatest: 'chatgpt-4o-latest',
  gpt4Turbo: 'gpt-4-turbo',
  gpt4: 'gpt-4',
  gpt3Turbo: 'gpt-3.5-turbo-0125',
  gpt3_16k: 'gpt-3.5-turbo-16k',
  gpt4oMini: 'gpt-4o-mini',
  o1: 'o1',
  o1Mini: 'o1-mini',
  o3Mini: 'o3-mini',
  o1Pro: 'o1-pro',
  gpt45Preview: 'gpt-4.5-preview',
};

const oModelsWithoutInstructions: OpenAIModel[] = [models.o1Mini, models.o1, models.o3Mini];
const oModelsWithAdjustableReasoningEffort: OpenAIModel[] = [models.o1, models.o3Mini, models.o1Pro];
const defaultInstructions = 'You are a helpful assistant.';

export const requestToGPT = async ({
  prompt,
  maxTokens,
  temperature,
  responseFormat,
  model,
  instructions,
  topP,
}: {
  prompt: string;
  maxTokens: number;
  temperature: number;
  responseFormat: 'text' | 'json_object';
  model: OpenAIModel;
  instructions?: string;
  topP?: number;
}): Promise<string> => {
  const openAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!openAi.apiKey) {
    throw new Error('No API key found for OpenAI');
  }

  const retryDelay = 1000;
  let attemptCount = 0;
  
  if (oModelsWithoutInstructions.includes(model) && instructions) {
    prompt = `
      ${instructions}

      -------

      ${prompt}
    `;
  }

  try {
    const messagesArray: ChatCompletionMessageParam[] = instructions
      ? [
          { role: 'system', content: instructions || defaultInstructions },
          { role: 'user', content: prompt },
        ]
      : [{ role: 'user', content: prompt }];

    const params: ChatCompletionCreateParamsNonStreaming = {
      model: model,
      messages: messagesArray,
      response_format: { type: responseFormat },
    };

    if (!oModelsWithoutInstructions.includes(model)) {
      params.max_tokens = maxTokens;
      params.temperature = temperature;
      params.top_p = topP || 1;
      params.presence_penalty = 0;
      params.frequency_penalty = 0;
    }

    if (oModelsWithAdjustableReasoningEffort.includes(model)) {
      params.reasoning_effort = 'medium';
    }

    const response = await openAi.chat.completions.create(params);

    if (!response.choices[0]?.message?.content) {
      throw new Error('No content in response');
    }

    const finalResponse = response.choices[0].message.content;

    if (finalResponse.trim().toLowerCase().replace('.', '') === "sorry i can't help you with that") {
      console.error('ChatGPT responded with a generic error');
      throw new Error('Error with OpenAI API');
    }

    return finalResponse;
  } catch (error: any) {
    console.error('Error with OpenAI API:', error);

    if (attemptCount < 1) {
      console.error(`Retrying after ${retryDelay} milliseconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      attemptCount++;
      
      return requestToGPT({
        prompt,
        maxTokens,
        temperature,
        responseFormat,
        model,
        instructions,
        topP,
      });
    } else {
      console.error('Error with OpenAI after retry');
      throw new Error('Error with OpenAI API');
    }
  }
};
