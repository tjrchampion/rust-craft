CREATE TABLE "character_achievements" (
	"character_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_achievements_character_id_achievement_id_pk" PRIMARY KEY("character_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "character_achievements" ADD CONSTRAINT "character_achievements_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
