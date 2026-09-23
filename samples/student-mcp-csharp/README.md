# Student MCP Server in C#

This is a small learning sample that shows how an MCP server can expose approved actions from a student information system.

The server uses:

- C# / .NET 10
- The official `ModelContextProtocol` .NET SDK
- SQLite through `Microsoft.Data.Sqlite`
- MCP stdio transport, which is the common transport for local AI tools

## What This Demonstrates

Your normal application owns the database and business rules. The MCP server exposes only selected tools that an AI assistant is allowed to call.

```text
AI assistant -> MCP stdio -> C# MCP server -> SQLite database
```

This sample exposes tools for:

- Searching students
- Getting a student profile
- Getting exam marks
- Finding students below a mark threshold
- Summarizing class performance
- Adding or updating an exam mark

## Run

From this folder:

```bash
dotnet restore
dotnet run
```

The app waits for MCP protocol messages on `stdin` and writes protocol responses to `stdout`. That means it is normally launched by an MCP client, not used directly like a web API.

## Example MCP Client Config

For a local MCP client, configure a server command like this:

```json
{
  "mcpServers": {
    "student-demo": {
      "command": "dotnet",
      "args": [
        "run",
        "--project",
        "D:/git/optiontrap/samples/student-mcp-csharp/StudentMcpServer.csproj"
      ]
    }
  }
}
```

After the client connects, try prompts like:

- `Search for students in class 8A`
- `Show Rahul's profile and marks`
- `Who scored below 50 in Mathematics?`
- `Summarize class 8A Midterm performance`
- `Add Final exam Mathematics mark 95 for Rahul`

## Tool Flow Example

If you ask: `Who scored below 50 in Mathematics?`

The AI client can call this MCP tool:

```text
FindStudentsBelowMark(subject: "Mathematics", threshold: 50, examName: "Midterm")
```

The C# tool runs a parameterized SQLite query and returns structured data. The AI then converts that result into a human-friendly answer.

## Files

- `Program.cs`: configures the MCP server and stdio transport
- `StudentDatabase.cs`: creates and seeds the SQLite database
- `StudentTools.cs`: MCP tools available to the AI client
- `StudentMcpServer.csproj`: project and package references

## Important Production Notes

For a real student app, do not let the MCP server directly bypass your main backend rules. Prefer:

- Calling your existing application APIs instead of querying production DB tables directly
- Authentication and authorization per teacher/admin user
- Audit logs for write tools
- Validation for marks, classes, exam names, and student ownership
- Read-only tools first, write tools only after you trust the workflow
