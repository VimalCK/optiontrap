using System.ComponentModel;
using Microsoft.Data.Sqlite;
using ModelContextProtocol.Server;

[McpServerToolType]
public sealed class StudentTools
{
    private readonly StudentDatabase _database;

    public StudentTools(StudentDatabase database)
    {
        _database = database;
    }

    [McpServerTool]
    [Description("Search students by name, class, roll number, or email.")]
    public async Task<IReadOnlyList<StudentSummary>> SearchStudents(
        [Description("Search text, for example 'Rahul', '8A', or '8A-01'.")]
        string query)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, class_name, roll_no, email
            FROM students
            WHERE name LIKE $query
               OR class_name LIKE $query
               OR roll_no LIKE $query
               OR email LIKE $query
            ORDER BY class_name, roll_no
            """;
        command.Parameters.AddWithValue("$query", $"%{query}%");

        var results = new List<StudentSummary>();
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            results.Add(new StudentSummary(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4)));
        }

        return results;
    }

    [McpServerTool]
    [Description("Get a student profile with all marks for that student.")]
    public async Task<StudentProfile?> GetStudentProfile(
        [Description("Student id returned by SearchStudents.")]
        int studentId)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        var studentCommand = connection.CreateCommand();
        studentCommand.CommandText = """
            SELECT id, name, class_name, roll_no, email
            FROM students
            WHERE id = $studentId
            """;
        studentCommand.Parameters.AddWithValue("$studentId", studentId);

        StudentSummary? student = null;
        await using (var reader = await studentCommand.ExecuteReaderAsync())
        {
            if (await reader.ReadAsync())
            {
                student = new StudentSummary(
                    reader.GetInt32(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4));
            }
        }

        if (student is null)
        {
            return null;
        }

        var marks = await GetMarksAsync(connection, studentId, examName: null);
        return new StudentProfile(student, marks);
    }

    [McpServerTool]
    [Description("Get marks for one student, optionally filtered by exam name.")]
    public async Task<IReadOnlyList<MarkDetail>> GetStudentMarks(
        [Description("Student id returned by SearchStudents.")]
        int studentId,
        [Description("Optional exam name, for example 'Midterm'.")]
        string? examName = null)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        return await GetMarksAsync(connection, studentId, examName);
    }

    [McpServerTool]
    [Description("Find students who scored below a mark threshold in a subject.")]
    public async Task<IReadOnlyList<StudentMarkResult>> FindStudentsBelowMark(
        [Description("Subject name, for example 'Mathematics'.")]
        string subject,
        [Description("Threshold mark. Students below this value are returned.")]
        int threshold,
        [Description("Optional exam name, for example 'Midterm'.")]
        string? examName = null)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.name, s.class_name, s.roll_no, sub.name, em.exam_name, em.marks, em.max_marks
            FROM exam_marks em
            JOIN students s ON s.id = em.student_id
            JOIN subjects sub ON sub.id = em.subject_id
            WHERE sub.name LIKE $subject
              AND em.marks < $threshold
              AND ($examName IS NULL OR em.exam_name = $examName)
            ORDER BY em.marks ASC
            """;
        command.Parameters.AddWithValue("$subject", $"%{subject}%");
        command.Parameters.AddWithValue("$threshold", threshold);
        command.Parameters.AddWithValue("$examName", (object?)examName ?? DBNull.Value);

        var results = new List<StudentMarkResult>();
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            results.Add(new StudentMarkResult(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetInt32(6),
                reader.GetInt32(7)));
        }

        return results;
    }

    [McpServerTool]
    [Description("Summarize class performance for an exam.")]
    public async Task<IReadOnlyList<ClassPerformanceSummary>> SummarizeClassPerformance(
        [Description("Class name, for example '8A'.")]
        string className,
        [Description("Exam name, for example 'Midterm'.")]
        string examName)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT sub.name,
                   ROUND(AVG(em.marks), 2) AS average_marks,
                   MIN(em.marks) AS lowest_marks,
                   MAX(em.marks) AS highest_marks,
                   COUNT(*) AS student_count
            FROM exam_marks em
            JOIN students s ON s.id = em.student_id
            JOIN subjects sub ON sub.id = em.subject_id
            WHERE s.class_name = $className
              AND em.exam_name = $examName
            GROUP BY sub.name
            ORDER BY sub.name
            """;
        command.Parameters.AddWithValue("$className", className);
        command.Parameters.AddWithValue("$examName", examName);

        var results = new List<ClassPerformanceSummary>();
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            results.Add(new ClassPerformanceSummary(
                reader.GetString(0),
                reader.GetDouble(1),
                reader.GetInt32(2),
                reader.GetInt32(3),
                reader.GetInt32(4)));
        }

        return results;
    }

    [McpServerTool]
    [Description("Add or update marks for one student, subject, and exam.")]
    public async Task<string> UpsertExamMark(
        [Description("Student id returned by SearchStudents.")]
        int studentId,
        [Description("Subject name, for example 'Mathematics'.")]
        string subject,
        [Description("Exam name, for example 'Final'.")]
        string examName,
        [Description("Marks scored by the student.")]
        int marks,
        [Description("Maximum possible marks for the exam.")]
        int maxMarks = 100)
    {
        await using var connection = _database.CreateConnection();
        await connection.OpenAsync();

        var subjectId = await GetOrCreateSubjectAsync(connection, subject);

        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO exam_marks (student_id, subject_id, exam_name, marks, max_marks)
            VALUES ($studentId, $subjectId, $examName, $marks, $maxMarks)
            ON CONFLICT(student_id, subject_id, exam_name) DO UPDATE SET
                marks = excluded.marks,
                max_marks = excluded.max_marks
            """;
        command.Parameters.AddWithValue("$studentId", studentId);
        command.Parameters.AddWithValue("$subjectId", subjectId);
        command.Parameters.AddWithValue("$examName", examName);
        command.Parameters.AddWithValue("$marks", marks);
        command.Parameters.AddWithValue("$maxMarks", maxMarks);

        await command.ExecuteNonQueryAsync();

        return $"Saved {marks}/{maxMarks} for student {studentId}, {subject}, {examName}.";
    }

    private static async Task<IReadOnlyList<MarkDetail>> GetMarksAsync(
        SqliteConnection connection,
        int studentId,
        string? examName)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT sub.name, em.exam_name, em.marks, em.max_marks
            FROM exam_marks em
            JOIN subjects sub ON sub.id = em.subject_id
            WHERE em.student_id = $studentId
              AND ($examName IS NULL OR em.exam_name = $examName)
            ORDER BY em.exam_name, sub.name
            """;
        command.Parameters.AddWithValue("$studentId", studentId);
        command.Parameters.AddWithValue("$examName", (object?)examName ?? DBNull.Value);

        var marks = new List<MarkDetail>();
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            marks.Add(new MarkDetail(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetInt32(2),
                reader.GetInt32(3)));
        }

        return marks;
    }

    private static async Task<int> GetOrCreateSubjectAsync(SqliteConnection connection, string subject)
    {
        var findCommand = connection.CreateCommand();
        findCommand.CommandText = "SELECT id FROM subjects WHERE name = $subject";
        findCommand.Parameters.AddWithValue("$subject", subject);

        var existingId = await findCommand.ExecuteScalarAsync();
        if (existingId is not null)
        {
            return Convert.ToInt32(existingId);
        }

        var insertCommand = connection.CreateCommand();
        insertCommand.CommandText = "INSERT INTO subjects (name) VALUES ($subject); SELECT last_insert_rowid();";
        insertCommand.Parameters.AddWithValue("$subject", subject);

        return Convert.ToInt32(await insertCommand.ExecuteScalarAsync());
    }
}

public sealed record StudentSummary(int Id, string Name, string ClassName, string RollNo, string Email);

public sealed record MarkDetail(string Subject, string ExamName, int Marks, int MaxMarks);

public sealed record StudentProfile(StudentSummary Student, IReadOnlyList<MarkDetail> Marks);

public sealed record StudentMarkResult(
    int StudentId,
    string Name,
    string ClassName,
    string RollNo,
    string Subject,
    string ExamName,
    int Marks,
    int MaxMarks);

public sealed record ClassPerformanceSummary(
    string Subject,
    double AverageMarks,
    int LowestMarks,
    int HighestMarks,
    int StudentCount);
