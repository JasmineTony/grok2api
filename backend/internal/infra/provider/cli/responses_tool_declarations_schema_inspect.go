package cli

import (
	"encoding/json"
	"fmt"
	"strings"
)

func rootObjectLeavesPairwiseDisjoint(leaves []map[string]any, doc map[string]any) bool {
	for i := 0; i < len(leaves); i++ {
		for j := i + 1; j < len(leaves); j++ {
			if !rootObjectSchemasDisjoint(leaves[i], leaves[j], doc) {
				return false
			}
		}
	}
	return true
}

type rootObjectSchemaFacts struct {
	required map[string]struct{}
	values   map[string]map[string]struct{}
}

func rootObjectSchemasDisjoint(left, right map[string]any, doc map[string]any) bool {
	leftFacts := collectRootObjectSchemaFacts(left, doc, nil)
	rightFacts := collectRootObjectSchemaFacts(right, doc, nil)
	for property := range leftFacts.required {
		if _, required := rightFacts.required[property]; !required {
			continue
		}
		leftValues, leftKnown := leftFacts.values[property]
		rightValues, rightKnown := rightFacts.values[property]
		if leftKnown && rightKnown && finiteValueSetsDisjoint(leftValues, rightValues) {
			return true
		}
	}
	return false
}

func collectRootObjectSchemaFacts(schema map[string]any, doc map[string]any, seen map[string]struct{}) rootObjectSchemaFacts {
	facts := rootObjectSchemaFacts{required: map[string]struct{}{}, values: map[string]map[string]struct{}{}}
	collectRootObjectSchemaFactsInto(schema, doc, seen, &facts)
	return facts
}

func collectRootObjectSchemaFactsInto(schema map[string]any, doc map[string]any, seen map[string]struct{}, facts *rootObjectSchemaFacts) {
	if ref, ok := schema["$ref"].(string); ok {
		if _, loop := seen[ref]; !loop {
			if resolved, resolvedOK := resolveLocalSchemaRef(doc, ref); resolvedOK {
				next := cloneRefSeen(seen)
				next[ref] = struct{}{}
				collectRootObjectSchemaFactsInto(resolved, doc, next, facts)
			}
		}
	}
	if required, ok := schema["required"].([]any); ok {
		for _, raw := range required {
			if property, ok := raw.(string); ok {
				facts.required[property] = struct{}{}
			}
		}
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		for property, raw := range properties {
			propertySchema, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			values, known := finiteSchemaValues(propertySchema, doc, nil)
			if !known {
				continue
			}
			if existing, exists := facts.values[property]; exists {
				facts.values[property] = intersectFiniteValueSets(existing, values)
			} else {
				facts.values[property] = values
			}
		}
	}
	if allOf, ok := schema["allOf"].([]any); ok {
		for _, raw := range allOf {
			if part, ok := raw.(map[string]any); ok {
				collectRootObjectSchemaFactsInto(part, doc, cloneRefSeen(seen), facts)
			}
		}
	}
}

func finiteSchemaValues(schema map[string]any, doc map[string]any, seen map[string]struct{}) (map[string]struct{}, bool) {
	if ref, ok := schema["$ref"].(string); ok {
		if _, loop := seen[ref]; loop {
			return nil, false
		}
		resolved, resolvedOK := resolveLocalSchemaRef(doc, ref)
		if !resolvedOK {
			return nil, false
		}
		next := cloneRefSeen(seen)
		next[ref] = struct{}{}
		return finiteSchemaValues(resolved, doc, next)
	}
	if value, exists := schema["const"]; exists {
		key, ok := finiteSchemaValueKey(value)
		if !ok {
			return nil, false
		}
		return map[string]struct{}{key: {}}, true
	}
	if values, ok := schema["enum"].([]any); ok {
		result := make(map[string]struct{}, len(values))
		for _, value := range values {
			key, valid := finiteSchemaValueKey(value)
			if !valid {
				return nil, false
			}
			result[key] = struct{}{}
		}
		return result, true
	}
	return nil, false
}

func finiteSchemaValueKey(value any) (string, bool) {
	switch value.(type) {
	case nil, bool, float64, string:
		raw, err := json.Marshal(value)
		return string(raw), err == nil
	default:
		return "", false
	}
}

func finiteValueSetsDisjoint(left, right map[string]struct{}) bool {
	for value := range left {
		if _, exists := right[value]; exists {
			return false
		}
	}
	return true
}

func intersectFiniteValueSets(left, right map[string]struct{}) map[string]struct{} {
	intersection := make(map[string]struct{})
	for value := range left {
		if _, exists := right[value]; exists {
			intersection[value] = struct{}{}
		}
	}
	return intersection
}

func referencedDefs(node any, doc map[string]any) map[string]any {
	rawDefs, _ := doc["$defs"].(map[string]any)
	if len(rawDefs) == 0 {
		return nil
	}
	needed := map[string]struct{}{}
	collectDefRefs(node, needed)
	changed := true
	for changed {
		changed = false
		for name := range needed {
			if mergeDefRefsIntoNeeded(rawDefs[name], needed) {
				changed = true
			}
		}
	}
	if len(needed) == 0 {
		return nil
	}
	out := make(map[string]any, len(needed))
	for name := range needed {
		if def, ok := rawDefs[name]; ok {
			out[name] = cloneJSONValue(def)
		}
	}
	return out
}

func mergeDefRefsIntoNeeded(def any, needed map[string]struct{}) bool {
	extra := map[string]struct{}{}
	collectDefRefs(def, extra)
	added := false
	for key := range extra {
		if _, exists := needed[key]; !exists {
			needed[key] = struct{}{}
			added = true
		}
	}
	return added
}

func collectDefRefs(node any, needed map[string]struct{}) {
	switch typed := node.(type) {
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") {
			if name, nameOK := rootDefinitionName(ref); nameOK {
				needed[name] = struct{}{}
			}
		}
		for _, value := range typed {
			collectDefRefs(value, needed)
		}
	case []any:
		for _, value := range typed {
			collectDefRefs(value, needed)
		}
	}
}

func rootDefinitionName(ref string) (string, bool) {
	tail := strings.TrimPrefix(ref, "#/$defs/")
	if tail == ref || tail == "" {
		return "", false
	}
	encoded := strings.SplitN(tail, "/", 2)[0]
	return strings.ReplaceAll(strings.ReplaceAll(encoded, "~1", "/"), "~0", "~"), true
}

func withoutNullSchemaTypes(types []any) ([]any, bool) {
	filtered := make([]any, 0, len(types))
	removed := false
	for _, value := range types {
		if value == "null" {
			removed = true
			continue
		}
		filtered = append(filtered, value)
	}
	return filtered, removed
}

func isNullOnlySchema(value any) bool {
	schema, ok := value.(map[string]any)
	if !ok {
		return false
	}
	if schema["type"] == "null" {
		return true
	}
	types, ok := schema["type"].([]any)
	if !ok || len(types) == 0 {
		return false
	}
	for _, value := range types {
		if value != "null" {
			return false
		}
	}
	return true
}

func isObjectRootSchema(schema, root map[string]any, visited map[string]struct{}) bool {
	rawType, hasType := schema["type"]
	if rawType == "object" {
		return true
	}
	if types, ok := rawType.([]any); ok && len(types) > 0 {
		for _, value := range types {
			if value != "object" {
				return false
			}
		}
		return true
	}
	if hasType {
		return false
	}
	if _, hasProperties := schema["properties"]; hasProperties {
		return true
	}
	ref, ok := schema["$ref"].(string)
	if !ok {
		return false
	}
	if visited == nil {
		visited = make(map[string]struct{})
	}
	if _, seen := visited[ref]; seen {
		return false
	}
	resolved, ok := resolveLocalSchemaRef(root, ref)
	if !ok {
		return false
	}
	visited[ref] = struct{}{}
	return isObjectRootSchema(resolved, root, visited)
}

func resolveLocalSchemaRef(root map[string]any, ref string) (map[string]any, bool) {
	if ref == "#" {
		return root, true
	}
	if !strings.HasPrefix(ref, "#/") {
		return nil, false
	}
	var current any = root
	for _, encoded := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
		segment := strings.ReplaceAll(strings.ReplaceAll(encoded, "~1", "/"), "~0", "~")
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[segment]
		if !ok {
			return nil, false
		}
	}
	resolved, ok := current.(map[string]any)
	return resolved, ok
}

func invalidBuildFunctionParametersRoot(context buildFunctionParametersRootContext) error {
	message := context.param + " 顶层必须是非 nullable 的 object schema"
	if context.toolName != "" {
		message = fmt.Sprintf("工具 %s 的 %s 顶层必须是非 nullable 的 object schema", context.toolName, context.param)
	}
	return &responsesRequestError{
		Message: message,
		Param:   context.param,
		Code:    "invalid_parameter",
	}
}
