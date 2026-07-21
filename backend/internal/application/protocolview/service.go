package protocolview

import (
    "bytes"
    "encoding/json"
    "errors"
    "fmt"
    "strings"
)

const (
    ProtocolResponses = "openai_responses"
    ProtocolChat = "openai_chat_completions"
    ProtocolAnthropic = "anthropic_messages"
)

type Canonical struct { Model string `json:"model"`; System json.RawMessage `json:"system,omitempty"`; Messages json.RawMessage `json:"messages"`; MaxTokens *int `json:"maxTokens,omitempty"`; Stream bool `json:"stream"` }
type Preview struct { Source string `json:"source"`; Target string `json:"target"`; Canonical Canonical `json:"canonical"`; Converted json.RawMessage `json:"converted"` }

func Convert(source,target string,payload []byte)(Preview,error){source=strings.TrimSpace(source);target=strings.TrimSpace(target);if !validProtocol(source)||!validProtocol(target){return Preview{},errors.New("unsupported protocol")};if len(payload)==0||len(payload)>256<<10{return Preview{},errors.New("payload must be between 1 byte and 256 KiB")};canonical,err:=normalize(source,payload);if err!=nil{return Preview{},err};converted,err:=encode(target,canonical);if err!=nil{return Preview{},err};return Preview{Source:source,Target:target,Canonical:canonical,Converted:converted},nil}
func validProtocol(value string)bool{return value==ProtocolResponses||value==ProtocolChat||value==ProtocolAnthropic}
func normalize(protocol string,payload []byte)(Canonical,error){
    switch protocol {
    case ProtocolResponses:
        var value struct{Model string `json:"model"`;Input json.RawMessage `json:"input"`;Stream bool `json:"stream"`;MaxOutputTokens *int `json:"max_output_tokens"`};if err:=decode(payload,&value);err!=nil{return Canonical{},err};if strings.TrimSpace(value.Model)==""||len(bytes.TrimSpace(value.Input))==0{return Canonical{},errors.New("responses payload requires model and input")};return Canonical{Model:value.Model,Messages:value.Input,MaxTokens:value.MaxOutputTokens,Stream:value.Stream},nil
    case ProtocolChat:
        var value struct{Model string `json:"model"`;Messages json.RawMessage `json:"messages"`;Stream bool `json:"stream"`;MaxTokens *int `json:"max_tokens"`};if err:=decode(payload,&value);err!=nil{return Canonical{},err};if strings.TrimSpace(value.Model)==""||len(bytes.TrimSpace(value.Messages))==0{return Canonical{},errors.New("chat payload requires model and messages")};return Canonical{Model:value.Model,Messages:value.Messages,MaxTokens:value.MaxTokens,Stream:value.Stream},nil
    default:
        var value struct{Model string `json:"model"`;System json.RawMessage `json:"system"`;Messages json.RawMessage `json:"messages"`;Stream bool `json:"stream"`;MaxTokens *int `json:"max_tokens"`};if err:=decode(payload,&value);err!=nil{return Canonical{},err};if strings.TrimSpace(value.Model)==""||value.MaxTokens==nil||*value.MaxTokens<1||len(bytes.TrimSpace(value.Messages))==0{return Canonical{},errors.New("anthropic payload requires model, max_tokens, and messages")};return Canonical{Model:value.Model,System:value.System,Messages:value.Messages,MaxTokens:value.MaxTokens,Stream:value.Stream},nil
    }
}
func encode(protocol string,value Canonical)(json.RawMessage,error){var output any;switch protocol{case ProtocolResponses:output=struct{Model string `json:"model"`;Input json.RawMessage `json:"input"`;Stream bool `json:"stream"`;MaxOutputTokens *int `json:"max_output_tokens,omitempty"`}{value.Model,value.Messages,value.Stream,value.MaxTokens};case ProtocolChat:output=struct{Model string `json:"model"`;Messages json.RawMessage `json:"messages"`;Stream bool `json:"stream"`;MaxTokens *int `json:"max_tokens,omitempty"`}{value.Model,value.Messages,value.Stream,value.MaxTokens};case ProtocolAnthropic:if value.MaxTokens==nil{fallback:=1024;value.MaxTokens=&fallback};output=struct{Model string `json:"model"`;System json.RawMessage `json:"system,omitempty"`;Messages json.RawMessage `json:"messages"`;Stream bool `json:"stream"`;MaxTokens int `json:"max_tokens"`}{value.Model,value.System,value.Messages,value.Stream,*value.MaxTokens};default:return nil,errors.New("unsupported protocol")};data,err:=json.Marshal(output);return data,err}
func decode(payload []byte,target any)error{decoder:=json.NewDecoder(bytes.NewReader(payload));decoder.UseNumber();if err:=decoder.Decode(target);err!=nil{return fmt.Errorf("invalid JSON: %w",err)};if decoder.More(){return errors.New("payload contains multiple JSON values")};return nil}
