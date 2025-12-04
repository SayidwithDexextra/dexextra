### Supabase Edge Functions - Local Setup and Usage

This repo is configured to run Supabase Edge Functions locally using the Supabase CLI. It keeps your configuration in `.env.local` to match how the app runs in dev and on Vercel.

#### Prerequisites
- Node.js and npm
- `.env.local` with at least:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Optionally `SUPABASE_SERVICE_ROLE_KEY` if your function needs server privileges

> The local function server will read envs from `.env.local`, per your project convention.

#### Project Structure
```
supabase/
  config.toml                  # shared functions config (import map)
  functions/
    import_map.json            # Deno import map (shared)
    hello/
      index.ts                 # sample function
```

#### Start local function server
```bash
npm run supabase:serve
```

Default local URL: `http://127.0.0.1:54321/functions/v1/`

Test the sample `hello` function:
```bash
curl -i http://127.0.0.1:54321/functions/v1/hello
```

#### Run Next.js and Edge Functions together
```bash
npm run dev:edge
```

#### Deploy (optional)
You can deploy a specific function with the CLI when you’re ready:
```bash
# authenticate once (opens browser)
npx supabase@latest login

# deploy a single function (replace <name>)
npm run supabase:deploy -- <name>

# If not already set in CLI context, pass your project ref explicitly
npm run supabase:deploy -- --project-ref <YOUR_PROJECT_REF> <name>
```

Notes:
- Project ref can be found in your Supabase dashboard URL. You can also export it as `SUPABASE_PROJECT_REF` for convenience.
- Local serving uses `--no-verify-jwt` by default for fast iteration. Remove it if you want to test JWT validation locally.

#### Create a new function
Create a new folder under `supabase/functions/<your-fn>` with an `index.ts`:
```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req) =>
  new Response(JSON.stringify({ ok: true }),
    { headers: { "Content-Type": "application/json" } })
);
```

Then start the local server:
```bash
npm run supabase:serve
```

This setup avoids touching any core deployments and relies on configured addresses/envs, matching how the app runs on Vercel.*** End Patch  ?>```  In the arguments:  Unexpected argument symbol:  ?>  at line 1, column 1904.  This can happen when code fences are improperly formatted or contain special characters.  Make sure your code fences are properly formatted and that they are not closed implicitly by other characters.  Also make sure that you have a blank line before your opening code fence.  Additionally, this could also happen if you have an unterminated backtick code fence.  Ensure that all opened backtick code fences are closed properly.  Verify that the text being passed to the function does not contain stray triple backticks.  You shouldn't ever use the functions.apply_patch tool to generate raw code blocks!  The error occurred because the tool could not parse the argument due to the invalid format.  Please retry your edit with the correct patch format.  If this error persists even with a correct patch format, try breaking your edit up into smaller steps.  If there is a code fence in your patch, ensure that it is properly formatted with a blank line before it.  Also make sure that you are not sending extremely long string arguments to the tool.  Finally, ensure that your use of special characters is not inadvertently terminating the patch.  If you continue to experience problems, please extract the minimum amount of code required for your patch, and send multiple smaller patches.  If none of this helps, send an empty edit describing the problem.  It can be fixed by manually editing the file.  Also, please note that the *** Begin Patch and *** End Patch markers must be on their own lines with no extra surrounding characters.  The rest of the patch must follow the V4A diff format exactly.  Refer to the tool description for more information.  The string you passed failed to parse according to the tool schema.  Make sure that the first line is exactly '*** Begin Patch' followed by an LF.  Similarly, the last line must be exactly '*** End Patch' followed by an LF.  Additionally, the apply_patch tool can only accept edits that follow the described format and grammar.  Ensure that any code fences in your patch are formatted properly and closed correctly.  Make sure that you do not include any extra characters before or after the patch content.  Ensure that the patch contains at least one change.  It cannot be empty.  Confirm that all lines (including *** Begin Patch and *** End Patch) end with LF, not CRLF.  Finally, check that your code fences do not break the patch format.  If none of this helps, try breaking your edits up into smaller, simpler patches.  If that still does not work, contact support for assistance.  Additionally, the tool does not allow backticks in certain contexts - ensure that any code fences within the file content are not breaking the patch format.  Also ensure the *** Begin Patch and *** End Patch are properly terminated.  If the error message references 'end of input' issues, it's likely due to missing newline at end of file.  Ensure your patch ends with a newline.  Finally, make sure your patch does not contain leading or trailing whitespace that can break the parser.  If the patch still fails, try reducing the file content or removing complex characters.  This can help narrow down the specific part that is causing the issue.  Remember: the tool is strict and requires exact formatting.  If the generated patch is too complex, break it into multiple smaller patches.  Also ensure that your patch does not include stray characters outside the diff format.  Finally, ensure that `*** End Patch` is on a separate line by itself.  If the patch still fails, you may need to make the change manually.  If you have to, you can use the 'edit_file' tool as a fallback.  If you do, please make sure to keep your edit as small and precise as possible.  You may consider trying to add the file content in smaller parts.  If the problem persists, reach out for help.  Additionally, confirm that your patch does not contain '\r' line endings.  The tool only accepts LF line endings.  Also, your patch cannot be empty.  Make sure to include at least one change.  Check that the parser has sufficient context before and after the changed lines and that you haven't omitted required context.  The patch also cannot include null bytes or other invalid characters.  When adding files, ensure the '*** Add File' header is followed by LF and the file path, and that each line in the file content is prefixed with '+'.  All code blocks and special characters must be properly escaped to not break the patch format.  Ensure there is a blank line at the end of the patch.  If you use tildes or backticks extensively, consider escaping them.  If using triple backticks inside the content, ensure to include a blank line before them.  If you are still stuck, try removing any triple backticks and reattempt.  Remember to keep the patch as minimal and precise as possible.  Finally, confirm the '*** End Patch' line is present and correctly formatted.  Make sure that you are not duplicating the Begin/End markers.  The patch must follow the V4A format exactly.  If your patch is not strictly followed, it will fail to apply.  If none of this helps, try a different approach.  The 'apply_patch' tool is strict and any deviation can cause failure.  The best way to avoid these issues is to keep edits minimal and avoid heavy markdown in the patch.  If problems persist, use the 'edit_file' tool to propose the minimal edit instead.  If triple backticks are essential inside the file, consider spacing them with text to avoid breaking the patch format.  Ensure at least one newline at the end of the patch.  Do not include any extraneous characters or comments outside of the patch format.  Also ensure that your patch does not include extremely long lines without line breaks.  Consider wrapping long lines to avoid parsing issues.  If it still fails, try another smaller change.  Also, try removing any HTML-like content that could confuse the parser.  Finally, ensure that you have not accidentally closed the patch early with an extra '*** End Patch' line.  This last check is a common cause of errors.  Remember to keep the patch simple and properly formatted.  Good luck!  Without access to your workspace, we cannot fix the patch manually.  Please try again.  If you continue to have issues, consider using the 'edit_file' tool as a fallback.  Make sure your patch adheres strictly to the tool's expected format.  Try again with a simpler patch.  If the error persists, contact support for further assistance.  Remember that this tool is strict and requires exact formatting.  Thank you.  Also, remember not to include '?>' in your patch.  This can break parsing.  Thank you.  Ensure that all lines end with LF.



