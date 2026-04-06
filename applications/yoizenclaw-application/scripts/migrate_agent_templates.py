#!/usr/bin/env python3
"""
Script to migrate existing agent templates to enhanced format.

This script helps convert legacy agent configurations to the new enhanced format
with intelligent skill routing, argument substitution, and execution modes.
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

# Add src to path for imports
sys.path.append(str(Path(__file__).parent.parent / "src"))

from src.utils.config.agent_config import EnhancedAgentSyncRequest


def migrate_legacy_skill(legacy_skill: Dict[str, Any]) -> Dict[str, Any]:
    """Migrate a single legacy skill to enhanced format."""
    enhanced_skill = dict(legacy_skill)
    
    # Add enhanced fields with defaults
    enhanced_skill.setdefault("when_to_use", "")
    enhanced_skill.setdefault("triggers", [])
    enhanced_skill.setdefault("arguments", [])
    enhanced_skill.setdefault("context_mode", "inline")
    enhanced_skill.setdefault("priority", 0)
    
    # Handle field aliases
    if "allowedTools" in enhanced_skill and "allowed_tools" not in enhanced_skill:
        enhanced_skill["allowed_tools"] = enhanced_skill.pop("allowedTools")
    
    return enhanced_skill


def suggest_triggers_for_skill(skill_name: str, instructions: str) -> List[str]:
    """Suggest triggers based on skill name and instructions."""
    name_lower = skill_name.lower()
    instructions_lower = instructions.lower()
    
    triggers = []
    
    # Common trigger patterns
    if "deploy" in name_lower or "deploy" in instructions_lower:
        triggers.extend(["/deploy", "/release"])
    elif "qualify" in name_lower or "lead" in name_lower:
        triggers.extend(["/qualify", "/lead"])
    elif "monitor" in name_lower or "alert" in name_lower:
        triggers.extend(["/monitor", "/alert"])
    elif "troubleshoot" in name_lower or "debug" in name_lower:
        triggers.extend(["/troubleshoot", "/debug"])
    elif "search" in name_lower or "find" in name_lower:
        triggers.extend(["/search", "/find"])
    elif "create" in name_lower or "provision" in name_lower:
        triggers.extend(["/create", "/provision"])
    elif "analyze" in name_lower or "report" in name_lower:
        triggers.extend(["/analyze", "/report"])
    elif "communicate" in name_lower or "email" in name_lower:
        triggers.extend(["/email", "/communicate"])
    elif "escalate" in name_lower or "urgent" in name_lower:
        triggers.extend(["/escalate", "/urgent"])
    elif "backup" in name_lower or "recover" in name_lower:
        triggers.extend(["/backup", "/recover"])
    else:
        # Generic triggers based on skill name
        triggers.append(f"/{skill_name.replace('_', '-')}")
    
    return list(set(triggers))  # Remove duplicates


def suggest_arguments_for_skill(instructions: str) -> List[str]:
    """Suggest arguments based on skill instructions."""
    instructions_lower = instructions.lower()
    
    # Common argument patterns
    argument_patterns = {
        "deploy": ["component", "environment", "version"],
        "qualify": ["lead_name", "company", "budget", "timeline"],
        "monitor": ["service_name", "environment", "metrics"],
        "troubleshoot": ["issue_type", "service_name", "error"],
        "search": ["query", "category", "keywords"],
        "create": ["resource_type", "name", "environment"],
        "analyze": ["data_source", "analysis_type", "format"],
        "communicate": ["recipient", "message", "channel"],
        "escalate": ["issue", "severity", "reason"],
        "backup": ["target", "destination", "type"],
    }
    
    arguments = []
    for keyword, args in argument_patterns.items():
        if keyword in instructions_lower:
            arguments.extend(args)
            break
    
    return list(set(arguments))  # Remove duplicates


def suggest_when_to_use(skill_name: str, instructions: str, description: str) -> str:
    """Suggest when_to_use based on skill metadata."""
    name_lower = skill_name.lower()
    instructions_lower = instructions.lower()
    description_lower = description.lower()
    
    # Common patterns
    if "deploy" in name_lower:
        return "Use when deploying applications, services, or infrastructure"
    elif "qualify" in name_lower or "lead" in name_lower:
        return "Use when qualifying sales leads or assessing customer potential"
    elif "monitor" in name_lower:
        return "Use when setting up monitoring, alerts, or observability"
    elif "troubleshoot" in name_lower:
        return "Use when troubleshooting issues, errors, or system problems"
    elif "search" in name_lower:
        return "Use when searching for information, documentation, or resources"
    elif "create" in name_lower or "provision" in name_lower:
        return "Use when creating resources, provisioning infrastructure, or setting up services"
    elif "analyze" in name_lower:
        return "Use when analyzing data, generating reports, or providing insights"
    elif "communicate" in name_lower:
        return "Use when communicating with users, sending notifications, or managing correspondence"
    elif "escalate" in name_lower:
        return "Use when escalating issues, handling urgent matters, or requiring management intervention"
    elif "backup" in name_lower:
        return "Use when creating backups, managing data protection, or disaster recovery"
    else:
        return f"Use when {description.lower()}" if description else "Use when this specific task is needed"


def enhance_agent_config(
    config: Dict[str, Any],
    auto_suggest: bool = True,
    enable_enhanced: bool = True
) -> Dict[str, Any]:
    """Enhance an agent configuration with new features."""
    enhanced_config = dict(config)
    
    # Add feature flags
    if enable_enhanced:
        enhanced_config["enableEnhancedSkills"] = True
        enhanced_config["enableSkillRouting"] = True
        enhanced_config["enableDiscoveryTools"] = True
    
    # Enhance skills
    enhanced_skills = []
    for skill in enhanced_config.get("skills", []):
        if auto_suggest and not any(key in skill for key in ["when_to_use", "triggers", "arguments"]):
            # This looks like a legacy skill, enhance it
            enhanced_skill = migrate_legacy_skill(skill)
            
            skill_name = skill.get("name", "")
            instructions = skill.get("instructions", "")
            description = skill.get("description", "")
            
            # Auto-suggest enhancements
            enhanced_skill["triggers"] = suggest_triggers_for_skill(skill_name, instructions)
            enhanced_skill["arguments"] = suggest_arguments_for_skill(instructions)
            enhanced_skill["when_to_use"] = suggest_when_to_use(skill_name, instructions, description)
            
            # Set priority based on skill type
            if "deploy" in skill_name.lower() or "critical" in instructions.lower():
                enhanced_skill["priority"] = 10
            elif "analyze" in skill_name.lower() or "escalate" in skill_name.lower():
                enhanced_skill["priority"] = 8
            elif "monitor" in skill_name.lower() or "communicate" in skill_name.lower():
                enhanced_skill["priority"] = 6
            else:
                enhanced_skill["priority"] = 5
            
            enhanced_skills.append(enhanced_skill)
        else:
            # Already enhanced or explicitly configured
            enhanced_skills.append(skill)
    
    enhanced_config["skills"] = enhanced_skills
    
    return enhanced_config


def migrate_agent_file(
    input_path: Path,
    output_path: Path | None = None,
    auto_suggest: bool = True,
    enable_enhanced: bool = True,
    backup: bool = True
) -> None:
    """Migrate a single agent configuration file."""
    input_path = Path(input_path)
    
    if not input_path.exists():
        print(f"❌ Input file not found: {input_path}")
        return
    
    # Read input file
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            if input_path.suffix == '.json':
                config = json.load(f)
            else:
                # Try to parse as JSON (some YAML files are actually JSON)
                content = f.read()
                config = json.loads(content)
    except Exception as e:
        print(f"❌ Error reading {input_path}: {e}")
        return
    
    # Create backup if requested
    if backup:
        backup_path = input_path.with_suffix(f"{input_path.suffix}.backup")
        try:
            with open(backup_path, 'w', encoding='utf-8') as f:
                if input_path.suffix == '.json':
                    json.dump(config, f, indent=2)
                else:
                    f.write(json.dumps(config, indent=2))
            print(f"📋 Backup created: {backup_path}")
        except Exception as e:
            print(f"⚠️  Warning: Could not create backup: {e}")
    
    # Enhance configuration
    try:
        enhanced_config = enhance_agent_config(config, auto_suggest, enable_enhanced)
        
        # Validate with EnhancedAgentSyncRequest
        EnhancedAgentSyncRequest(**enhanced_config)
        print("✅ Configuration validation passed")
    except Exception as e:
        print(f"❌ Configuration validation failed: {e}")
        return
    
    # Determine output path
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}-enhanced{input_path.suffix}")
    
    # Write enhanced configuration
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(enhanced_config, f, indent=2, ensure_ascii=False)
        print(f"✅ Enhanced configuration written: {output_path}")
        
        # Show summary
        print(f"\n📊 Migration Summary:")
        print(f"   Skills: {len(config.get('skills', []))} → {len(enhanced_config.get('skills', []))}")
        print(f"   Enhanced Features: {'✅' if enable_enhanced else '❌'}")
        print(f"   Auto-suggestions: {'✅' if auto_suggest else '❌'}")
        
        # Show skill enhancements
        for i, skill in enumerate(enhanced_config.get('skills', [])):
            triggers = skill.get('triggers', [])
            arguments = skill.get('arguments', [])
            priority = skill.get('priority', 0)
            print(f"   Skill {i+1}: {skill.get('name', 'unnamed')} - {len(triggers)} triggers, {len(arguments)} arguments, priority {priority}")
        
    except Exception as e:
        print(f"❌ Error writing enhanced configuration: {e}")


def main():
    """Main migration script."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Migrate agent templates to enhanced format")
    parser.add_argument("input", help="Input agent configuration file or directory")
    parser.add_argument("-o", "--output", help="Output file or directory")
    parser.add_argument("--no-auto-suggest", action="store_true", help="Disable automatic suggestions")
    parser.add_argument("--no-enhanced", action="store_true", help="Disable enhanced features")
    parser.add_argument("--no-backup", action="store_true", help="Skip backup creation")
    
    args = parser.parse_args()
    
    input_path = Path(args.input)
    
    if not input_path.exists():
        print(f"❌ Input path not found: {input_path}")
        return 1
    
    auto_suggest = not args.no_auto_suggest
    enable_enhanced = not args.no_enhanced
    backup = not args.no_backup
    
    if input_path.is_file():
        # Migrate single file
        output_path = Path(args.output) if args.output else None
        migrate_agent_file(input_path, output_path, auto_suggest, enable_enhanced, backup)
    
    elif input_path.is_dir():
        # Migrate directory
        output_dir = Path(args.output) if args.output else input_path
        
        # Find agent configuration files
        agent_files = list(input_path.glob("**/*.json")) + list(input_path.glob("**/*.yaml")) + list(input_path.glob("**/*.yml"))
        
        if not agent_files:
            print(f"❌ No agent configuration files found in {input_path}")
            return 1
        
        print(f"🔍 Found {len(agent_files)} agent files")
        
        for file_path in agent_files:
            if output_dir.is_dir():
                relative_path = file_path.relative_to(input_path)
                output_path = output_dir / relative_path
            else:
                output_path = None
            
            print(f"\n📁 Processing: {file_path}")
            migrate_agent_file(file_path, output_path, auto_suggest, enable_enhanced, backup)
    
    else:
        print(f"❌ Input path is neither file nor directory: {input_path}")
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
