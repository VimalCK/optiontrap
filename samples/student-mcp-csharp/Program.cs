using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

builder.Logging.AddConsole(options =>
{
    // MCP stdio uses stdout for protocol messages, so logs must go to stderr.
    options.LogToStandardErrorThreshold = LogLevel.Trace;
});

var databasePath = Path.Combine(AppContext.BaseDirectory, "students.db");

builder.Services.AddSingleton(new StudentDatabase(databasePath));
builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithTools<StudentTools>();

var app = builder.Build();

var database = app.Services.GetRequiredService<StudentDatabase>();
await database.InitializeAsync();

await app.RunAsync();
