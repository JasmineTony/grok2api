package protocolview
import("encoding/json";"testing")
func TestConvertChatToAnthropic(t *testing.T){preview,err:=Convert(ProtocolChat,ProtocolAnthropic,[]byte(`{"model":"grok-4","messages":[{"role":"user","content":"hi"}],"max_tokens":64}`));if err!=nil{t.Fatal(err)};var value map[string]any;if err:=json.Unmarshal(preview.Converted,&value);err!=nil{t.Fatal(err)};if value["model"]!="grok-4"||value["max_tokens"]!=float64(64){t.Fatalf("converted=%s",preview.Converted)}}
func TestConvertRejectsOversizedPayload(t *testing.T){if _,err:=Convert(ProtocolChat,ProtocolResponses,make([]byte,(256<<10)+1));err==nil{t.Fatal("expected limit error")}}
