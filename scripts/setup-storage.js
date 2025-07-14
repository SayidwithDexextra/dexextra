const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing Supabase environment variables");
  console.error(
    "Make sure you have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function setupStorage() {
  try {
    console.log("🔧 Setting up Supabase storage bucket...");

    // Create the bucket
    const { data: bucket, error: bucketError } =
      await supabase.storage.createBucket("market-images", {
        public: true,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/gif",
          "image/webp",
        ],
      });

    if (bucketError && !bucketError.message.includes("already exists")) {
      console.error("❌ Error creating bucket:", bucketError);
      return;
    }

    if (bucketError?.message.includes("already exists")) {
      console.log('✅ Bucket "market-images" already exists');
    } else {
      console.log('✅ Created storage bucket "market-images"');
    }

    // Set up storage policies
    console.log("🔐 Setting up storage policies...");

    const policies = [
      {
        name: "Allow public uploads to market-images bucket",
        definition: `CREATE POLICY "Allow public uploads to market-images bucket" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'market-images');`,
      },
      {
        name: "Allow public access to market-images bucket",
        definition: `CREATE POLICY "Allow public access to market-images bucket" ON storage.objects
        FOR SELECT USING (bucket_id = 'market-images');`,
      },
      {
        name: "Allow public updates to market-images bucket",
        definition: `CREATE POLICY "Allow public updates to market-images bucket" ON storage.objects
        FOR UPDATE USING (bucket_id = 'market-images') WITH CHECK (bucket_id = 'market-images');`,
      },
      {
        name: "Allow public deletes from market-images bucket",
        definition: `CREATE POLICY "Allow public deletes from market-images bucket" ON storage.objects
        FOR DELETE USING (bucket_id = 'market-images');`,
      },
    ];

    for (const policy of policies) {
      const { error: policyError } = await supabase.rpc("exec_sql", {
        sql: policy.definition,
      });

      if (policyError && !policyError.message.includes("already exists")) {
        console.warn(
          `⚠️  Warning setting up policy "${policy.name}":`,
          policyError.message
        );
      } else {
        console.log(`✅ Policy "${policy.name}" set up successfully`);
      }
    }

    console.log("🎉 Storage setup complete!");
    console.log('You can now upload images to the "market-images" bucket.');
  } catch (error) {
    console.error("❌ Error setting up storage:", error);
  }
}

setupStorage();
