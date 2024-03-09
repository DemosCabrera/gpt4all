"use strict";

/// This file implements the gpt4all.d.ts file endings.
/// Written in commonjs to support both ESM and CJS projects.
const { existsSync } = require("node:fs");
const path = require("node:path");
const Stream = require("node:stream");
const assert = require("node:assert");
const { LLModel } = require("node-gyp-build")(path.resolve(__dirname, ".."));
const {
    retrieveModel,
    downloadModel,
    appendBinSuffixIfMissing,
} = require("./util.js");
const {
    DEFAULT_DIRECTORY,
    DEFAULT_LIBRARIES_DIRECTORY,
    DEFAULT_PROMPT_CONTEXT,
    DEFAULT_MODEL_CONFIG,
    DEFAULT_MODEL_LIST_URL,
} = require("./config.js");
const { InferenceModel, EmbeddingModel } = require("./models.js");

/**
 * Loads a machine learning model with the specified name. The defacto way to create a model.
 * By default this will download a model from the official GPT4ALL website, if a model is not present at given path.
 *
 * @param {string} modelName - The name of the model to load.
 * @param {LoadModelOptions|undefined} [options] - (Optional) Additional options for loading the model.
 * @returns {Promise<InferenceModel | EmbeddingModel>} A promise that resolves to an instance of the loaded LLModel.
 */
async function loadModel(modelName, options = {}) {
    const loadOptions = {
        modelPath: DEFAULT_DIRECTORY,
        librariesPath: DEFAULT_LIBRARIES_DIRECTORY,
        type: "inference",
        allowDownload: true,
        verbose: false,
        device: "cpu",
        nCtx: 2048,
        ngl: 100,
        ...options,
    };

    const modelConfig = await retrieveModel(modelName, {
        modelPath: loadOptions.modelPath,
        modelConfigFile: loadOptions.modelConfigFile,
        allowDownload: loadOptions.allowDownload,
        verbose: loadOptions.verbose,
    });

    assert.ok(typeof loadOptions.librariesPath === "string", "Libraries path should be a string");
    const existingPaths = loadOptions.librariesPath
        .split(";")
        .filter(existsSync)
        .join(";");

    const llmOptions = {
        model_name: appendBinSuffixIfMissing(modelName),
        model_path: loadOptions.modelPath,
        library_path: existingPaths,
        device: loadOptions.device,
        nCtx: loadOptions.nCtx,
        ngl: loadOptions.ngl,
    };

    if (loadOptions.verbose) {
        console.debug("Creating LLModel:", {
            llmOptions,
            modelConfig,
        });
    }
    const llmodel = new LLModel(llmOptions);
    if (loadOptions.type === "embedding") {
        return new EmbeddingModel(llmodel, modelConfig);
    } else if (loadOptions.type === "inference") {
        return new InferenceModel(llmodel, modelConfig);
    } else {
        throw Error("Invalid model type: " + loadOptions.type);
    }
}

function createEmbedding(model, text) {
    return model.embed(text);
}

const defaultCompletionOptions = {
    verbose: false,
    ...DEFAULT_PROMPT_CONTEXT,
};

async function createCompletion(
    provider,
    message,
    options = defaultCompletionOptions
) {
    const optionsWithDefaults = {
        ...defaultCompletionOptions,
        ...options,
    };

    let tokensGenerated = 0;

    const response = await provider.generate(
        message,
        optionsWithDefaults,
        (tokenId, text, fullText) => {
            if (optionsWithDefaults.verbose) {
                console.debug("Got token", {
                    tokenId,
                    text,
                });
            }

            let continueGeneration = true;

            if (options.onToken) {
                // don't wanna cancel the generation if the users callback returns undefined
                continueGeneration =
                    options.onToken(tokenId, text, fullText) !== false;
            }

            tokensGenerated++;
            return continueGeneration;
        }
    );

    return {
        llmodel: provider.modelName,
        usage: {
            prompt_tokens: message.length,
            completion_tokens: tokensGenerated,
            total_tokens: message.length + tokensGenerated, //TODO Not sure how to get tokens in prompt
        },
        message: {
            role: "assistant",
            content: response,
        },
    };
}

function createCompletionStream(
    provider,
    message,
    options = defaultCompletionOptions
) {
    const completionStream = new Stream.PassThrough({
        encoding: "utf-8",
    });

    const completionPromise = createCompletion(provider, message, {
        ...options,
        onToken: (tokenId, text, fullText) => {
            completionStream.push(text);
            if (options.onToken) {
                return options.onToken(tokenId, text, fullText);
            }
        },
    }).then((result) => {
        completionStream.push(null);
        completionStream.emit("end");
        return result;
    });

    return {
        tokens: completionStream,
        result: completionPromise,
    };
}

async function* createCompletionGenerator(provider, message, options) {
    const completion = createCompletionStream(provider, message, options);
    for await (const chunk of completion.tokens) {
        yield chunk;
    }
    return await completion.result;
}

module.exports = {
    DEFAULT_LIBRARIES_DIRECTORY,
    DEFAULT_DIRECTORY,
    DEFAULT_PROMPT_CONTEXT,
    DEFAULT_MODEL_CONFIG,
    DEFAULT_MODEL_LIST_URL,
    LLModel,
    InferenceModel,
    EmbeddingModel,
    createCompletion,
    createCompletionStream,
    createCompletionGenerator,
    createEmbedding,
    downloadModel,
    retrieveModel,
    loadModel,
};
