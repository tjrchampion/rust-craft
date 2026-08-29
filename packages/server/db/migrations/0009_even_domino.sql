CREATE TABLE "character_poi_discoveries" (
	"character_id" uuid NOT NULL,
	"poi_id" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_poi_discoveries_character_id_poi_id_pk" PRIMARY KEY("character_id","poi_id")
);
--> statement-breakpoint
ALTER TABLE "character_poi_discoveries" ADD CONSTRAINT "character_poi_discoveries_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;