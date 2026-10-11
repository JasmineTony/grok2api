package cli

import (
	"fmt"
	"reflect"
	"strings"
)

const maxRootUnionDepth = 32
const maxRootUnionLeaves = 32

type buildFunctionParametersRootContext struct {
	param    string
	toolName string
}

type rootObjectLeafCollector struct {
	doc              map[string]any
	context          buildFunctionParametersRootContext
	leaves           []map[string]any
	rootUnionKeyword string
	requiresDisjoint bool
	changed          bool
}

// NormalizeBuildFunctionParametersRoot rewrites a function parameters schema so
// Grok Build can compile it: the root is an object, or a root union of object
// leaves. Nested oneOf/anyOf at the root are lifted; $ref inside properties
// and recursive property $ref are left alone.
func NormalizeBuildFunctionParametersRoot(value any, param, toolName string) (any, bool, error) {
	return normalizeBuildFunctionParametersRootForTool(value, param, toolName)
}

// normalizeBuildFunctionParametersRoot removes root-level nullability from function schemas
// and lifts nested root unions. Nested nullable fields remain untouched.
func normalizeBuildFunctionParametersRoot(value any, param string) (any, bool, error) {
	return normalizeBuildFunctionParametersRootForTool(value, param, "")
}

func normalizeBuildFunctionParametersRootForTool(value any, param, toolName string) (any, bool, error) {
	schema, ok := value.(map[string]any)
	if !ok {
		return nil, false, invalidBuildFunctionParametersRoot(buildFunctionParametersRootContext{param: param, toolName: toolName})
	}
	doc := cloneJSONObject(schema)
	context := buildFunctionParametersRootContext{param: param, toolName: toolName}
	collector := rootObjectLeafCollector{doc: doc, context: context}
	if err := collector.walk(doc, nil, nil, 0, 0); err != nil {
		return nil, false, err
	}
	if len(collector.leaves) == 0 {
		return nil, false, invalidBuildFunctionParametersRoot(context)
	}
	if collector.requiresDisjoint && !rootObjectLeavesPairwiseDisjoint(collector.leaves, doc) {
		return nil, false, invalidBuildFunctionParametersRoot(context)
	}
	if !collector.changed {
		return doc, false, nil
	}
	var out map[string]any
	if len(collector.leaves) == 1 {
		out = collector.leaves[0]
	} else {
		if collector.rootUnionKeyword == "" {
			return nil, false, invalidBuildFunctionParametersRoot(context)
		}
		branches := make([]any, len(collector.leaves))
		for i, leaf := range collector.leaves {
			branches[i] = leaf
		}
		out = map[string]any{collector.rootUnionKeyword: branches}
	}
	delete(out, "$defs")
	if defs := referencedDefs(out, doc); len(defs) > 0 {
		out["$defs"] = defs
	}
	return out, !reflect.DeepEqual(out, schema), nil
}

func (c *rootObjectLeafCollector) walk(node any, constraints []map[string]any, seen map[string]struct{}, depth, unionDepth int) error {
	if depth > maxRootUnionDepth || len(c.leaves) > maxRootUnionLeaves {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	schema, ok := node.(map[string]any)
	if !ok {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if _, isRef := schema["$ref"].(string); isRef {
		return c.walkSchemaRef(schema, constraints, seen, depth, unionDepth)
	}
	normalized, nullOnly, typeChanged := normalizeRootObjectType(schema)
	if nullOnly {
		c.changed = true
		return nil
	}
	if typeChanged {
		c.changed = true
	}
	keyword, branches, unionErr := rootUnion(normalized)
	if unionErr != nil {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if keyword != "" {
		return c.walkRootUnion(normalized, keyword, branches, constraints, seen, depth, unionDepth)
	}
	return c.appendObjectLeaf(normalized, constraints, unionDepth)
}

// walkSchemaRef 解析本地 $ref 并把同级约束叠加到后续叶子。
func (c *rootObjectLeafCollector) walkSchemaRef(schema map[string]any, constraints []map[string]any, seen map[string]struct{}, depth, unionDepth int) error {
	ref, _ := schema["$ref"].(string)
	if !strings.HasPrefix(ref, "#/") {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if _, loop := seen[ref]; loop {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	resolved, ok := resolveLocalSchemaRef(c.doc, ref)
	if !ok {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	sibling, siblingErr := rootSchemaSiblingConstraint(schema, "$ref")
	if siblingErr != nil {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if len(sibling) > 0 {
		constraints = append(cloneRootConstraints(constraints), sibling)
	}
	next := cloneRefSeen(seen)
	next[ref] = struct{}{}
	c.changed = true
	return c.walk(resolved, constraints, next, depth+1, unionDepth)
}

// walkRootUnion 记录根联合关键字并把同级约束叠加到分支。
func (c *rootObjectLeafCollector) walkRootUnion(normalized map[string]any, keyword string, branches []any, constraints []map[string]any, seen map[string]struct{}, depth, unionDepth int) error {
	if c.rootUnionKeyword == "" {
		c.rootUnionKeyword = keyword
	} else {
		c.changed = true
		if c.rootUnionKeyword == "oneOf" || keyword != c.rootUnionKeyword {
			c.requiresDisjoint = true
		}
	}
	sibling, siblingErr := rootSchemaSiblingConstraint(normalized, keyword)
	if siblingErr != nil {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if len(sibling) > 0 {
		constraints = append(cloneRootConstraints(constraints), sibling)
	}
	for _, branch := range branches {
		if err := c.walkRootUnionBranch(branch, constraints, seen, depth, unionDepth); err != nil {
			return err
		}
	}
	return nil
}

// walkRootUnionBranch 递归处理根联合的单个分支，非对象分支按不可表达丢弃。
func (c *rootObjectLeafCollector) walkRootUnionBranch(branch any, constraints []map[string]any, seen map[string]struct{}, depth, unionDepth int) error {
	// Build function parameters may contain a nullable or otherwise
	// non-object alternative at the root. Such alternatives cannot be
	// represented by Build's grammar and are intentionally omitted; the
	// whole schema is rejected below when no object leaf remains.
	branchSchema, branchOK := branch.(map[string]any)
	if !branchOK || isNullOnlySchema(branchSchema) {
		c.changed = true
		return nil
	}
	branchKeyword, _, branchErr := rootUnion(branchSchema)
	if branchErr != nil {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	// A root $ref may point to another union (for example a named
	// Create schema). Let walk resolve it before deciding whether its
	// leaves are object schemas.
	if branchKeyword == "" && branchSchema["$ref"] == nil && !isObjectRootSchema(branchSchema, c.doc, nil) {
		c.changed = true
		return nil
	}
	return c.walk(branch, constraints, cloneRefSeen(seen), depth+1, unionDepth+1)
}

// appendObjectLeaf 把归一化后的对象 schema 作为叶子收集，并叠加父级约束。
func (c *rootObjectLeafCollector) appendObjectLeaf(normalized map[string]any, constraints []map[string]any, unionDepth int) error {
	if unionDepth == 0 && c.rootUnionKeyword != "" {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	if !isObjectRootSchema(normalized, c.doc, nil) {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	leaf := cloneJSONObject(normalized)
	if leaf["type"] != "object" {
		leaf["type"] = "object"
		c.changed = true
	}
	delete(leaf, "$defs")
	leaf = applyRootConstraints(leaf, constraints)
	c.leaves = append(c.leaves, leaf)
	if len(c.leaves) > maxRootUnionLeaves {
		return invalidBuildFunctionParametersRoot(c.context)
	}
	return nil
}

func rootUnion(schema map[string]any) (string, []any, error) {
	var keyword string
	var branches []any
	for _, candidate := range []string{"anyOf", "oneOf"} {
		raw, exists := schema[candidate]
		if !exists {
			continue
		}
		if keyword != "" {
			return "", nil, fmt.Errorf("multiple root unions")
		}
		parsed, ok := raw.([]any)
		if !ok || len(parsed) == 0 {
			return "", nil, fmt.Errorf("invalid root union")
		}
		keyword, branches = candidate, parsed
	}
	return keyword, branches, nil
}

func normalizeRootObjectType(schema map[string]any) (map[string]any, bool, bool) {
	out := cloneJSONObject(schema)
	rawTypes, isArray := out["type"].([]any)
	if !isArray {
		return out, out["type"] == "null", false
	}
	filtered, removedNull := withoutNullSchemaTypes(rawTypes)
	if len(filtered) == 0 {
		return out, true, removedNull
	}
	for _, value := range filtered {
		if value != "object" {
			return out, false, false
		}
	}
	out["type"] = "object"
	return out, false, true
}

func rootSchemaSiblingConstraint(schema map[string]any, excluded string) (map[string]any, error) {
	constraint := make(map[string]any)
	for key, value := range schema {
		switch key {
		case excluded, "$defs":
			continue
		case "anyOf", "oneOf":
			return nil, fmt.Errorf("multiple root expressions")
		case "type":
			if value == "object" {
				continue
			}
		case "properties":
			if properties, ok := value.(map[string]any); ok && len(properties) == 0 {
				continue
			}
		case "required":
			if required, ok := value.([]any); ok && len(required) == 0 {
				continue
			}
		case "additionalProperties":
			if allowed, ok := value.(bool); ok && allowed {
				continue
			}
		}
		constraint[key] = cloneJSONValue(value)
	}
	return constraint, nil
}

func cloneRootConstraints(constraints []map[string]any) []map[string]any {
	return append([]map[string]any(nil), constraints...)
}

func applyRootConstraints(leaf map[string]any, constraints []map[string]any) map[string]any {
	if len(constraints) == 0 {
		return leaf
	}
	allOf := make([]any, 0, len(constraints))
	for _, constraint := range constraints {
		if len(constraint) > 0 {
			allOf = append(allOf, cloneJSONObject(constraint))
		}
	}
	allOf = append(allOf, leaf)
	return map[string]any{"type": "object", "allOf": allOf}
}

func cloneRefSeen(seen map[string]struct{}) map[string]struct{} {
	out := make(map[string]struct{}, len(seen))
	for key, value := range seen {
		out[key] = value
	}
	return out
}
